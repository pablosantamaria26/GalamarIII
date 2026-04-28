// ── Configuración global de la app ─────────────────────────
const SUPABASE_URL = 'https://uqbeeluqmgzbmlfsxtge.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SnVVNAsxjeUb_q5Q5ytZOQ_XQT4yb1J';
const WORKER_URL   = 'https://galamar3.santamariapablodaniel.workers.dev';
const APP_SECRET   = 'GalamarExpensas2026';

// ── Cliente Supabase (SDK oficial vía CDN) ──────────────────
// El SDK se carga en cada HTML antes de este script:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
let _sb = null;
function getSB() {
  if (!_sb) {
    if (typeof supabase === 'undefined') {
      throw new Error('Supabase SDK no cargado. Verificá la conexión a internet.');
    }
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _sb;
}

// ── Wrapper con la misma interfaz que antes ─────────────────
const SB = {
  async get(table, params = '') {
    let q = getSB().from(table).select('*');
    // Parsear params tipo PostgREST query string
    if (params) {
      q = _applyParams(q, table, params);
    }
    const { data, error } = await q;
    if (error) throw new Error(`SB GET ${table}: ${error.message}`);
    return data || [];
  },

  async post(table, data) {
    const { data: res, error } = await getSB()
      .from(table).insert(data).select();
    if (error) throw new Error(`SB POST ${table}: ${error.message}`);
    return res || [];
  },

  async patch(table, id, data) {
    const { data: res, error } = await getSB()
      .from(table).update(data).eq('id', id).select();
    if (error) throw new Error(`SB PATCH ${table}: ${error.message}`);
    return res || [];
  },

  async patchWhere(table, filter, data) {
    // filter: 'tipo=eq.AD' o 'codigo=eq.PB Local 1'
    let q = getSB().from(table).update(data);
    q = _applyFilter(q, filter);
    const { data: res, error } = await q.select();
    if (error) throw new Error(`SB PATCH ${table}: ${error.message}`);
    return res || [];
  },

  async delete(table, id) {
    const { error } = await getSB().from(table).delete().eq('id', id);
    if (error) throw new Error(`SB DELETE ${table}: ${error.message}`);
    return true;
  },

  async upsert(table, data, onConflict = '') {
    const opts = onConflict ? { onConflict } : {};
    const { data: res, error } = await getSB()
      .from(table).upsert(data, opts).select();
    if (error) throw new Error(`SB UPSERT ${table}: ${error.message}`);
    return res || [];
  }
};

// ── Parsear query string PostgREST → métodos SDK ────────────
function _applyParams(q, table, params) {
  const parts = params.split('&');
  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('order=')) {
      const val = part.replace('order=', '');
      const [col, dir] = val.split('.');
      q = q.order(col, { ascending: dir !== 'desc' });
      continue;
    }

    if (part.startsWith('limit=')) {
      q = q.limit(parseInt(part.replace('limit=', '')));
      continue;
    }

    if (part.startsWith('select=')) {
      const sel = part.replace('select=', '');
      q = getSB().from(table).select(sel);
      continue;
    }

    // Filtros: col=op.val
    q = _applyFilter(q, part);
  }
  return q;
}

function _applyFilter(q, filter) {
  const m = filter.match(/^([^=]+)=([a-z]+)\.(.+)$/);
  if (!m) return q;
  const [, col, op, val] = m;
  switch (op) {
    case 'eq':  return q.eq(col, val === 'true' ? true : val === 'false' ? false : val);
    case 'neq': return q.neq(col, val);
    case 'gt':  return q.gt(col, val);
    case 'gte': return q.gte(col, val);
    case 'lt':  return q.lt(col, val);
    case 'lte': return q.lte(col, val);
    case 'like': return q.like(col, val);
    case 'ilike': return q.ilike(col, val);
    default: return q;
  }
}

// ── Helpers de formato ──────────────────────────────────────
function fmt$(n) {
  const num = parseFloat(n) || 0;
  return '$\u00a0' + Math.abs(num).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
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
