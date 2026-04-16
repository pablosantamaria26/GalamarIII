// ── Configuración global de la app ─────────────────────────
const SUPABASE_URL = 'https://uqbeeluqmgzbmlfsxtge.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SnVVNAsxjeUb_q5Q5ytZOQ_XQT4yb1J';
const WORKER_URL   = 'https://galamar3.santamariapablodaniel.workers.dev';
const APP_SECRET   = 'GalamarExpensas2026';

// ── Cliente REST de Supabase (sin librería, llamadas directas) ─
const SB = {
  headers: {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation'
  },

  async get(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`, {
      headers: this.headers
    });
    if (!res.ok) throw new Error(`SB GET ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async post(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method:  'POST',
      headers: this.headers,
      body:    JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`SB POST ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async patch(table, id, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method:  'PATCH',
      headers: this.headers,
      body:    JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`SB PATCH ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async patchWhere(table, filter, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
      method:  'PATCH',
      headers: this.headers,
      body:    JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`SB PATCH ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async delete(table, id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method:  'DELETE',
      headers: this.headers
    });
    if (!res.ok) throw new Error(`SB DELETE ${table}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? true : res.json();
  },

  async upsert(table, data, onConflict = '') {
    const headers = { ...this.headers };
    if (onConflict) headers['Prefer'] = `resolution=merge-duplicates,return=representation`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${onConflict ? '?on_conflict=' + onConflict : ''}`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`SB UPSERT ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  },

  async rpc(fn, params = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method:  'POST',
      headers: this.headers,
      body:    JSON.stringify(params)
    });
    if (!res.ok) throw new Error(`SB RPC ${fn}: ${res.status} ${await res.text()}`);
    return res.json();
  }
};

// ── Helpers de formato ─────────────────────────────────────
function fmt$(n) {
  const num = parseFloat(n) || 0;
  return '$\u00a0' + Math.abs(num).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPeriodo(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

function periodoISO(year, month) {
  return `${year}-${String(month).padStart(2,'0')}-01`;
}

function mesActual() {
  const now = new Date();
  return periodoISO(now.getFullYear(), now.getMonth() + 1);
}

function calcularExpensa(unidad, precioCochera) {
  return parseFloat(unidad.precio_base) + (unidad.cocheras.length * parseFloat(precioCochera));
}

// ── Toast global ────────────────────────────────────────────
let _toastTimer;
function toast(msg, tipo = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'show' + (tipo ? ' ' + tipo : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 3800);
}
