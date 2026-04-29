/**
 * Cloudflare Worker — Expensas Galamar III
 * Endpoints:
 *   POST /banco/parse      → parsea CSV del extracto bancario (XLSX se parsea en el navegador)
 *   POST /banco/analizar   → clasifica todas las transacciones: pagos por unidad,
 *                            gastos bancarios, gastos del edificio. Usa Gemini para no reconocidos.
 *   GET  /health           → ping
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Expensas-Key',
};

// Códigos de unidad válidos para Galamar III
const VALID_UNITS = new Set([
  '1A','1B','1C','1D','2A','2B','2C','2D','3A','3B','3C','3D',
  '4A','4B','4C','4D','5A','5B','5C','5D','6A','6B','6C','6D',
  '7A','7B','7C','7D','8A','8B','8C','8D','9A','9B',
  'LOCAL 1','LOCAL 2','PORTERIA','LOCAL PB1','LOCAL PB2','DPTO PB',
  '4A Y 4B','4AY4B'
]);

function normalizeUnit(u) {
  if (!u) return null;
  const s = String(u).trim().toUpperCase();
  if (VALID_UNITS.has(s)) return s;
  if (s === '4AY4B') return '4A Y 4B';
  if (s === 'LOCAL' || s === 'LOCAL PB1') return 'LOCAL 1';
  if (s === 'LOCAL PB2') return 'LOCAL 2';
  if (s === 'PORTERIA ANTICIPO' || s === 'PORTERIA ALQUILER') return 'PORTERIA';
  return null;
}

// Patrones hardcodeados para cargos bancarios (descripcion del banco, siempre iguales)
const BANK_CHARGE_PATTERNS = [
  'Imp. Deb. Ley','IMP. DEB. LEY',
  'Imp. Cre. Ley','IMP. CRE. LEY',
  'Imp. Ing. Brutos','IMP. ING. BRUTOS',
  'Percep. Iva','PERCEP. IVA',
  'Comision Servicio','Comision Mantenimiento','COMISION MANTENIMIENTO',
  'Com. Movimientos','COM. MOVIMIENTOS',
  'Com. Gestion Transf',
  'Com Dep Efvo','Comision Depositos En Efectivo','COMISION DEPOSITOS EN EFECTIVO',
  'Debito Debin','DEBITO DEBIN',
];

// Patrones hardcodeados para gastos del edificio (ley1 = nombre del proveedor/servicio)
const BUILDING_BY_LEY1 = [
  { pat: 'CESOP',  cat: 'CESOP',  label: 'CESOP – WiFi, cámaras, obras sanitarias, luz' },
  { pat: 'HOLAND', cat: 'SEGURO', label: 'La Holando Sudamericana – Seguro integral' },
];
// Por ley2 (etiqueta)
const BUILDING_BY_LEY2 = [
  { pat: 'CESOP',   cat: 'CESOP',   label: 'CESOP – Servicios' },
  { pat: 'WIFI',    cat: 'CESOP',   label: 'CESOP – Internet WiFi cámaras' },
  { pat: 'SEGURO',  cat: 'SEGURO',  label: 'Seguro integral' },
  { pat: 'LIMPIEZA',cat: 'LIMPIEZA',label: 'Servicio de limpieza' },
];

// Categorías de ingresos especiales (no son pagos de expensas de unidades)
const SPECIAL_INCOME = ['PORTERIA','LUZ PORTERIA','ALQUILER DPTO PB','DPTO PB','LOCAL'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
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
      return json({ ok: false, error: 'Ruta no encontrada' }, 404);
    } catch (err) {
      console.error(err);
      return json({ ok: false, error: err.message }, 500);
    }
  }
};

// ─────────────────────────────────────────────────────────────
// PARSE CSV: formato Banco Galicia
// Devuelve transacciones con ley1 y ley2 separados
// ─────────────────────────────────────────────────────────────
async function handleParse(request, env) {
  const form = await request.formData();
  const file = form.get('archivo');
  if (!file) return json({ ok: false, error: 'Falta el archivo' }, 400);
  const nombre = file.name.toLowerCase();
  const buffer = await file.arrayBuffer();
  if (!nombre.endsWith('.csv')) {
    return json({ ok: false, error: 'El Worker solo procesa CSV. Los XLSX se parsean en el navegador.' }, 400);
  }
  const transacciones = parseCSV(buffer);
  return json({ ok: true, total: transacciones.length, transacciones });
}

// ─────────────────────────────────────────────────────────────
// ANALIZAR: clasifica TODAS las transacciones del extracto
//   Recibe: { transacciones, unidades, patrones_pago }
//   Devuelve:
//     pagos_unidades[]   — créditos asignados a unidad
//     gastos_bancarios   — { total, detalle[] } débitos = cargos del banco
//     gastos_edificio    — { CESOP: {total,items[]}, SEGURO: ..., LIMPIEZA: ... }
//     ingresos_especiales[] — portería, alquiler dpto PB, etc.
//     no_reconocidos[]   — para revisión manual + Gemini
// ─────────────────────────────────────────────────────────────
async function handleAnalizar(request, env) {
  const body = await request.json();
  const { transacciones, unidades = [], patrones_pago = [] } = body;

  if (!transacciones?.length) return json({ ok: false, error: 'No hay transacciones' }, 400);

  const pagos_unidades    = [];
  const gastos_bancarios  = { total: 0, detalle: [] };
  const gastos_edificio   = {};
  const ingresos_especiales = [];
  const no_reconocidos    = [];

  // Índice rápido: patron (uppercase) → unidad_codigo
  const patronIndex = {};
  for (const p of patrones_pago) {
    if (p.patron && p.unidad_codigo) {
      patronIndex[p.patron.toUpperCase()] = { codigo: p.unidad_codigo, id: p.unidad_id || null };
    }
  }

  for (const t of transacciones) {
    const desc  = String(t.descripcion || '').trim();
    const ley1  = String(t.ley1 || t.leyenda || '').trim();  // nombre titular/servicio
    const ley2  = String(t.ley2 || '').trim();               // unidad/etiqueta
    const debito  = parseFloat(t.debito  || 0);
    const credito = parseFloat(t.credito || 0);

    // ── DÉBITOS ───────────────────────────────────────────────
    if (debito > 0 && credito === 0) {
      // 1. ¿Es cargo bancario?
      if (isBankCharge(desc)) {
        gastos_bancarios.total += debito;
        gastos_bancarios.detalle.push({ fecha: t.fecha, descripcion: desc, ley1, monto: debito });
        continue;
      }

      // 2. ¿Es gasto del edificio por ley1?
      const buildingL1 = matchBuilding(ley1.toUpperCase(), BUILDING_BY_LEY1);
      if (buildingL1) {
        addGastoEdificio(gastos_edificio, buildingL1.cat, buildingL1.label, { fecha: t.fecha, descripcion: desc, ley1, ley2, monto: debito });
        continue;
      }

      // 3. ¿Es gasto del edificio por ley2?
      const buildingL2 = matchBuilding(ley2.toUpperCase(), BUILDING_BY_LEY2);
      if (buildingL2) {
        addGastoEdificio(gastos_edificio, buildingL2.cat, buildingL2.label, { fecha: t.fecha, descripcion: desc, ley1, ley2, monto: debito });
        continue;
      }

      // 4. ¿Es transferencia a proveedor (limpieza, administración, etc.)?
      if (desc.toLowerCase().includes('trf inmed proveed') || desc.toLowerCase().includes('transf. a terceros') || desc.toLowerCase().includes('transferencias cash')) {
        addGastoEdificio(gastos_edificio, 'PROVEEDOR', 'Transferencia a proveedor', { fecha: t.fecha, descripcion: ley1 || desc, ley1, ley2, monto: debito });
        continue;
      }

      // 5. Ignorar débitos de bajo monto que son comisiones no clasificadas
      if (debito < 100) {
        gastos_bancarios.total += debito;
        gastos_bancarios.detalle.push({ fecha: t.fecha, descripcion: desc, ley1, monto: debito });
        continue;
      }

      // 6. Débito no clasificado → no_reconocidos
      no_reconocidos.push({ ...t, tipo: 'debito', motivo: 'Débito no clasificado' });
      continue;
    }

    // ── CRÉDITOS ──────────────────────────────────────────────
    if (credito > 0) {
      // 1. ¿Es ingreso especial? (portería, alquiler, luz portería)
      const ley2Up = ley2.toUpperCase();
      if (SPECIAL_INCOME.some(s => ley2Up.includes(s)) && !normalizeUnit(ley2)) {
        ingresos_especiales.push({ fecha: t.fecha, descripcion: ley1 || desc, ley2, monto: credito });
        continue;
      }

      // 2. ¿ley2 es un código de unidad directo? (puesto por el inquilino al transferir)
      const unitDirecto = normalizeUnit(ley2);
      if (unitDirecto) {
        pagos_unidades.push({
          fecha: t.fecha, monto: credito,
          unidad_codigo: unitDirecto, unidad_id: resolveUnitId(unitDirecto, unidades),
          nombre: ley1, descripcion: desc, origen: t.origen || '',
          confianza: 0.98, fuente: 'leyenda_directa',
          razon: `Código de unidad "${unitDirecto}" en referencia de la transferencia`
        });
        continue;
      }

      // 3. ¿ley1 coincide con un patrón conocido?
      const matchPat = findPatron(ley1, patronIndex);
      if (!matchPat) {
        // También buscar en descripción completa
      }
      const matchFull = matchPat || findPatron(desc, patronIndex);
      if (matchFull) {
        pagos_unidades.push({
          fecha: t.fecha, monto: credito,
          unidad_codigo: matchFull.codigo, unidad_id: matchFull.id,
          nombre: ley1, descripcion: desc, origen: t.origen || '',
          confianza: 0.90, fuente: 'patron',
          razon: `Patrón conocido: "${matchFull.patron}" → ${matchFull.codigo}`
        });
        continue;
      }

      // 4. Créditos pequeños (< $1000) → ignorar (son impuestos al crédito ya sumados)
      if (credito < 1000) continue;

      // 5. No reconocido → Gemini
      no_reconocidos.push({ ...t, ley1, ley2, tipo: 'credito', motivo: 'No reconocido' });
    }
  }

  // ── Gemini para no reconocidos ────────────────────────────
  const creditosPendientes = no_reconocidos.filter(r => r.tipo === 'credito');
  if (creditosPendientes.length > 0 && env.GEMINI_API_KEY) {
    const geminiRes = await analizarConGemini(creditosPendientes, unidades, patrones_pago, env.GEMINI_API_KEY);
    for (const gr of geminiRes) {
      if (gr.unidad_codigo) {
        // Mover de no_reconocidos a pagos_unidades
        const idx = no_reconocidos.findIndex(r => r._idx === gr._idx);
        if (idx >= 0) no_reconocidos.splice(idx, 1);
        pagos_unidades.push({
          fecha: gr.fecha, monto: gr.credito,
          unidad_codigo: gr.unidad_codigo,
          unidad_id: resolveUnitId(gr.unidad_codigo, unidades),
          nombre: gr.ley1 || gr.leyenda || '', descripcion: gr.descripcion, origen: gr.origen || '',
          confianza: gr.confianza || 0.7, fuente: 'gemini',
          razon: gr.razon || 'Identificado por IA'
        });
      }
    }
  }

  // ── Redondear total gastos bancarios ─────────────────────
  gastos_bancarios.total = Math.round(gastos_bancarios.total * 100) / 100;

  return json({
    ok: true,
    resumen: {
      pagos_unidades:     pagos_unidades.length,
      gastos_bancarios:   gastos_bancarios.total,
      gastos_edificio:    Object.keys(gastos_edificio).length,
      ingresos_especiales:ingresos_especiales.length,
      no_reconocidos:     no_reconocidos.filter(r => r.tipo === 'credito').length,
    },
    pagos_unidades,
    gastos_bancarios,
    gastos_edificio,
    ingresos_especiales,
    no_reconocidos,
  });
}

// ─────────────────────────────────────────────────────────────
// Gemini: analiza créditos no reconocidos con contexto de patrones
// ─────────────────────────────────────────────────────────────
async function analizarConGemini(pendientes, unidades, patrones_pago, apiKey) {
  const listaUnidades = unidades
    .map(u => `${u.codigo}${u.propietario ? ' (' + u.propietario + ')' : ''}`)
    .join('\n');

  const listaPatrones = patrones_pago
    .slice(0, 60)
    .map(p => `"${p.patron}" → ${p.unidad_codigo}`)
    .join('\n');

  const txLines = pendientes.map((t, i) => {
    const tx = { ...t, _idx: i };
    return `[${i}] Fecha: ${t.fecha} | Desc: ${t.descripcion} | Ley1: ${t.ley1||t.leyenda||''} | Ley2: ${t.ley2||''} | Monto: $${t.credito}`;
  }).join('\n');

  const prompt = `Sos el asistente de administración del Consorcio Galamar III (edificio en Argentina).
Tu tarea: identificar a qué unidad corresponde cada pago bancario recibido.

UNIDADES DEL EDIFICIO:
${listaUnidades}

PATRONES CONOCIDOS (titular → unidad):
${listaPatrones}

PAGOS A IDENTIFICAR:
${txLines}

Reglas importantes:
- "Ley1" es el nombre del titular de la cuenta que transfirió
- "Ley2" es el código de unidad o referencia que escribió al transferir
- Si Ley2 tiene un código de unidad válido (ej: "3D", "2B") usalo directamente
- Si el nombre en Ley1 coincide con algún titular o patrón conocido, asignalo
- Si no podés identificar con certeza, poné unidad_codigo: null y confianza: 0

Respondé SOLO con JSON array válido, sin texto adicional:
[
  { "_idx": 0, "unidad_codigo": "3C", "confianza": 0.95, "razon": "Patrón CHUMBA coincide con 3°C" },
  { "_idx": 1, "unidad_codigo": null, "confianza": 0, "razon": "No se pudo identificar" }
]`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.05, maxOutputTokens: 2048 }
        })
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.map(item => ({
      ...pendientes[item._idx],
      _idx: item._idx,
      unidad_codigo: item.unidad_codigo,
      confianza:     item.confianza,
      razon:         item.razon,
    }));
  } catch (err) {
    console.error('Gemini error:', err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers de clasificación
// ─────────────────────────────────────────────────────────────
function isBankCharge(desc) {
  const d = desc.toUpperCase();
  return BANK_CHARGE_PATTERNS.some(p => d.includes(p.toUpperCase()));
}

function matchBuilding(text, patterns) {
  for (const p of patterns) {
    if (text.includes(p.pat)) return p;
  }
  return null;
}

function addGastoEdificio(map, cat, label, item) {
  if (!map[cat]) map[cat] = { categoria: cat, etiqueta: label, total: 0, items: [] };
  map[cat].total = Math.round((map[cat].total + item.monto) * 100) / 100;
  map[cat].items.push(item);
}

function findPatron(text, patronIndex) {
  if (!text) return null;
  const up = text.toUpperCase();
  // Exact match primero
  if (patronIndex[up]) return { ...patronIndex[up], patron: up };
  // Substring: el texto contiene el patrón o el patrón contiene el texto
  for (const [pat, val] of Object.entries(patronIndex)) {
    if (up.includes(pat) || pat.includes(up.substring(0, Math.min(up.length, 20)))) {
      if (pat.length >= 5 && up.includes(pat)) return { ...val, patron: pat };
    }
  }
  return null;
}

function resolveUnitId(codigo, unidades) {
  return unidades.find(u => u.codigo?.toUpperCase() === codigo?.toUpperCase())?.id || null;
}

// ─────────────────────────────────────────────────────────────
// PARSE CSV: formato Banco Galicia
// Columnas: Fecha | Descripción | Origen | Débitos | Créditos | Ley1 | Ley2
// ─────────────────────────────────────────────────────────────
function parseCSV(buffer) {
  const text = new TextDecoder('latin1').decode(buffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const transacciones = [];
  let headerFound = false;
  for (const line of lines) {
    const cols = splitCSVLine(line);
    if (!headerFound) {
      const low = line.toLowerCase();
      if (low.includes('fecha') && (low.includes('descripci') || low.includes('debito') || low.includes('credito'))) {
        headerFound = true;
      }
      continue;
    }
    if (cols.length < 4) continue;
    const fecha       = parseDate(cols[0]);
    const descripcion = clean(cols[1]);
    const origen      = clean(cols[2]);
    const debito      = parseMonto(cols[3]);
    const credito     = parseMonto(cols[4] || '');
    const ley1        = clean(cols[5] || '');
    const ley2        = clean(cols[6] || '');
    if (!fecha && !descripcion) continue;
    transacciones.push({ fecha, descripcion, origen, debito, credito, ley1, ley2 });
  }
  return transacciones;
}

function splitCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if ((ch === ',' || ch === ';') && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseDate(str) {
  if (!str) return null;
  const s = str.trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  return s;
}

function parseMonto(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[^\d,.\-]/g, '').replace(',', '.')) || 0;
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
