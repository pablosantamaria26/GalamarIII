/**
 * Cloudflare Worker — Expensas Galamar III
 * Endpoints:
 *   POST /banco/parse      → parsea XLSX/CSV del extracto bancario
 *   POST /banco/analizar   → llama Gemini para reconocer pagos por unidad
 *   GET  /health           → ping
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Expensas-Key',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Autenticación simple por header
    const key = request.headers.get('X-Expensas-Key');
    if (key !== env.APP_SECRET) {
      return json({ ok: false, error: 'No autorizado' }, 401);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/health') {
        return json({ ok: true, ts: new Date().toISOString() });
      }

      if (url.pathname === '/banco/parse' && request.method === 'POST') {
        return await handleParse(request, env);
      }

      if (url.pathname === '/banco/analizar' && request.method === 'POST') {
        return await handleAnalizar(request, env);
      }

      if (url.pathname === '/pdf/datos' && request.method === 'POST') {
        return await handlePdfDatos(request, env);
      }

      return json({ ok: false, error: 'Ruta no encontrada' }, 404);

    } catch (err) {
      console.error(err);
      return json({ ok: false, error: err.message }, 500);
    }
  }
};

// ─────────────────────────────────────────────────────────────
// PARSE: recibe FormData con archivo XLSX o CSV del banco
// devuelve array de transacciones normalizadas
// ─────────────────────────────────────────────────────────────
async function handleParse(request, env) {
  const form = await request.formData();
  const file = form.get('archivo');
  if (!file) return json({ ok: false, error: 'Falta el archivo' }, 400);

  const nombre = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();

  let transacciones = [];

  if (nombre.endsWith('.csv')) {
    transacciones = parseCSV(buffer);
  } else if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
    // Para XLSX usamos SheetJS CDN desde el worker
    transacciones = await parseXLSX(buffer);
  } else {
    return json({ ok: false, error: 'Formato no soportado. Usar CSV o XLSX.' }, 400);
  }

  return json({ ok: true, total: transacciones.length, transacciones });
}

// ─────────────────────────────────────────────────────────────
// ANALIZAR: recibe array de transacciones + unidades/patrones
// llama a Gemini y devuelve cada transacción con unidad asignada
// ─────────────────────────────────────────────────────────────
async function handleAnalizar(request, env) {
  const body = await request.json();
  const { transacciones, unidades, patrones } = body;

  if (!transacciones?.length) return json({ ok: false, error: 'No hay transacciones' }, 400);

  // Filtrar solo créditos (pagos recibidos), mayores a $1000
  const creditos = transacciones.filter(t => parseFloat(t.credito || 0) > 1000);

  if (!creditos.length) return json({ ok: true, resultados: [] });

  // Primero aplicar patrones conocidos localmente
  const resultados = creditos.map(t => {
    const texto = `${t.descripcion || ''} ${t.origen || ''} ${t.leyenda || ''}`.toUpperCase();
    const match = patrones.find(p => texto.includes(p.patron.toUpperCase()));
    if (match) {
      return {
        ...t,
        unidad_codigo: match.unidad_codigo,
        unidad_id:     match.unidad_id,
        confianza:     0.92,
        fuente:        'patron',
        razon:         `Patrón conocido: "${match.patron}"`
      };
    }
    return { ...t, unidad_codigo: null, unidad_id: null, confianza: 0, fuente: 'pendiente', razon: '' };
  });

  // Los no reconocidos → Gemini
  const pendientes = resultados.filter(r => r.fuente === 'pendiente');

  if (pendientes.length > 0 && env.GEMINI_API_KEY) {
    const geminiResultados = await analizarConGemini(pendientes, unidades, env.GEMINI_API_KEY);

    // Merge resultados Gemini
    geminiResultados.forEach(gr => {
      const idx = resultados.findIndex(r => r._idx === gr._idx);
      if (idx >= 0) {
        resultados[idx] = { ...resultados[idx], ...gr, fuente: 'gemini' };
      }
    });
  }

  return json({ ok: true, total: creditos.length, reconocidos: resultados.filter(r => r.unidad_id).length, resultados });
}

// ─────────────────────────────────────────────────────────────
// Gemini: analiza transacciones no reconocidas
// ─────────────────────────────────────────────────────────────
async function analizarConGemini(pendientes, unidades, apiKey) {
  const listaUnidades = unidades.map(u => `${u.codigo} (${u.propietario || 'sin nombre'})`).join('\n');

  const txLines = pendientes.map((t, i) =>
    `[${i}] Fecha: ${t.fecha} | Descripción: ${t.descripcion} | Origen: ${t.origen} | Monto: $${t.credito} | Leyenda: ${t.leyenda || ''}`
  ).join('\n');

  const prompt = `Sos el asistente de administración del Consorcio Galamar III.
Tenés que identificar a qué unidad del edificio corresponde cada transferencia bancaria recibida.

UNIDADES DEL EDIFICIO:
${listaUnidades}

TRANSFERENCIAS A IDENTIFICAR:
${txLines}

Para cada transferencia, respondé SOLO con JSON array válido con este formato exacto:
[
  { "_idx": 0, "unidad_codigo": "3°C", "confianza": 0.87, "razon": "El texto contiene CHUMBA que históricamente corresponde a 3°C" },
  { "_idx": 1, "unidad_codigo": null, "confianza": 0, "razon": "No se pudo identificar la unidad" }
]

Reglas:
- Si el texto menciona un apellido o nombre que figura en los propietarios, asignalo con alta confianza
- Si hay un código de unidad en el texto (ej: "3D", "2B"), usalo
- Si no podés identificar con certeza, poné unidad_codigo: null y confianza: 0
- Solo responder el JSON, sin texto adicional`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
        })
      }
    );

    if (!res.ok) throw new Error(`Gemini error: ${res.status}`);

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // Extraer JSON del texto (puede venir con ```json ... ```)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);

    // Enriquecer con _idx original
    return parsed.map((item, i) => ({
      ...pendientes[item._idx],
      ...item,
      unidad_id: null // lo resuelve el frontend con el codigo
    }));

  } catch (err) {
    console.error('Gemini error:', err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// PARSE CSV: formato Banco Galicia
// Columnas: Fecha | Descripción | Origen | Débitos | Créditos | Leyendas | Saldo
// ─────────────────────────────────────────────────────────────
function parseCSV(buffer) {
  const text = new TextDecoder('latin1').decode(buffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const transacciones = [];
  let headerFound = false;

  for (const line of lines) {
    const cols = splitCSVLine(line);

    // Buscar línea de header
    if (!headerFound) {
      const low = line.toLowerCase();
      if (low.includes('fecha') && (low.includes('descripci') || low.includes('debito') || low.includes('credito'))) {
        headerFound = true;
      }
      continue;
    }

    if (cols.length < 4) continue;

    const fecha      = parseDate(cols[0]);
    const descripcion = clean(cols[1]);
    const origen     = clean(cols[2]);
    const debito     = parseMonto(cols[3]);
    const credito    = parseMonto(cols[4] || '');
    const leyenda    = clean(cols[5] || '');
    const saldo      = parseMonto(cols[6] || '');

    if (!fecha && !descripcion) continue;

    transacciones.push({ fecha, descripcion, origen, debito, credito, leyenda, saldo_banco: saldo });
  }

  return transacciones;
}

// ─────────────────────────────────────────────────────────────
// PARSE XLSX: usa API binaria manual (sin librería externa)
// Para Workers: fetch SheetJS WASM o usar lógica básica
// ─────────────────────────────────────────────────────────────
async function parseXLSX(buffer) {
  // Usamos SheetJS CDN via dynamic import no disponible en Workers
  // Alternativa: convertir a CSV en el cliente y subir CSV al Worker
  // Por ahora retornamos error orientativo
  throw new Error('Para XLSX: convertir a CSV desde Excel antes de subir, o usar el parser del navegador. El Worker acepta CSV directamente.');
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    if (ch === ';' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseDate(str) {
  if (!str) return null;
  const s = str.trim();
  // dd/mm/yyyy o dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return s;
}

function parseMonto(str) {
  if (!str) return 0;
  const s = str.replace(/[^\d,.\-]/g, '').replace(',', '.');
  return parseFloat(s) || 0;
}

function clean(str) {
  return (str || '').trim().replace(/\s+/g, ' ');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

// ─────────────────────────────────────────────────────────────
// Datos para PDF (próximamente)
// ─────────────────────────────────────────────────────────────
async function handlePdfDatos(request, env) {
  // El PDF se genera en el navegador con jsPDF
  // Este endpoint puede servir los datos consolidados si hace falta
  return json({ ok: true, mensaje: 'PDF generado en el navegador' });
}
