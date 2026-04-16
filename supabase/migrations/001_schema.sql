-- ============================================================
-- SCHEMA: Sistema de Expensas Galamar III
-- ============================================================

-- Configuración global editable desde la app
CREATE TABLE IF NOT EXISTS configuracion (
  clave        TEXT PRIMARY KEY,
  valor        TEXT NOT NULL,
  descripcion  TEXT,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Unidades del edificio
CREATE TABLE IF NOT EXISTS unidades (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       TEXT UNIQUE NOT NULL,   -- '1°B', '3°D', 'PB Local 1', '9°A'
  propietario  TEXT DEFAULT '',
  tipo         TEXT NOT NULL,          -- 'AD' | 'BC' | 'local' | '9piso'
  precio_base  DECIMAL(12,2) NOT NULL, -- sin cochera
  cocheras     INT[] DEFAULT '{}',     -- ej: [9] o [14,15] o []
  activa       BOOLEAN DEFAULT true,
  orden        INT DEFAULT 0,          -- para ordenar en la tabla
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Liquidaciones mensuales (cabecera por período)
CREATE TABLE IF NOT EXISTS liquidaciones (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo               DATE NOT NULL UNIQUE,   -- primer día del mes: 2026-04-01
  estado                TEXT DEFAULT 'borrador', -- 'borrador' | 'publicada'
  saldo_caja_anterior   DECIMAL(12,2) DEFAULT 0,
  ingreso_alquiler_pb   DECIMAL(12,2) DEFAULT 0,
  ingreso_luz_porteria  DECIMAL(12,2) DEFAULT 0,
  total_ingresos        DECIMAL(12,2) DEFAULT 0,
  total_egresos         DECIMAL(12,2) DEFAULT 0,
  saldo_caja_final      DECIMAL(12,2) DEFAULT 0,
  pdf_url               TEXT,
  notas                 TEXT,
  fecha_vencimiento     DATE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Ítems de gastos / egresos del mes
CREATE TABLE IF NOT EXISTS gastos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id  UUID REFERENCES liquidaciones(id) ON DELETE CASCADE,
  proveedor       TEXT NOT NULL,
  descripcion     TEXT NOT NULL,
  monto           DECIMAL(12,2) NOT NULL,
  categoria       TEXT NOT NULL DEFAULT 'otro',  -- 'servicios' | 'mantenimiento' | 'seguro' | 'administrativo' | 'bancario' | 'otro'
  aplica_a        TEXT DEFAULT 'todos',           -- 'todos' | 'cocheras' | unidad codigo
  es_recurrente   BOOLEAN DEFAULT false,
  orden           INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Saldo y movimientos por unidad por período
CREATE TABLE IF NOT EXISTS saldos_mensuales (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_id            UUID REFERENCES unidades(id) ON DELETE CASCADE,
  liquidacion_id       UUID REFERENCES liquidaciones(id) ON DELETE CASCADE,
  periodo              DATE NOT NULL,
  saldo_anterior       DECIMAL(12,2) DEFAULT 0,
  expensa_mes          DECIMAL(12,2) DEFAULT 0,  -- precio_base + cocheras al momento
  gastos_particulares  DECIMAL(12,2) DEFAULT 0,  -- gastos especiales (ej: reparación cocheras)
  pagos                DECIMAL(12,2) DEFAULT 0,
  punitorios           DECIMAL(12,2) DEFAULT 0,
  saldo_final          DECIMAL(12,2) DEFAULT 0,  -- calculado
  notas                TEXT,
  UNIQUE(unidad_id, periodo)
);

-- Transacciones del banco (raw del extracto subido)
CREATE TABLE IF NOT EXISTS transacciones_banco (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_id  UUID REFERENCES liquidaciones(id) ON DELETE CASCADE,
  fecha           DATE,
  descripcion     TEXT,
  origen          TEXT,
  debito          DECIMAL(12,2) DEFAULT 0,
  credito         DECIMAL(12,2) DEFAULT 0,
  leyenda         TEXT,
  saldo_banco     DECIMAL(12,2),
  unidad_id       UUID REFERENCES unidades(id) ON DELETE SET NULL,
  confianza       DECIMAL(4,3),   -- 0.000 a 1.000
  confirmada      BOOLEAN DEFAULT false,
  es_expensa      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Patrones aprendidos: descripción del banco → unidad
CREATE TABLE IF NOT EXISTS patrones_pago (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patron      TEXT NOT NULL,
  unidad_id   UUID REFERENCES unidades(id) ON DELETE CASCADE,
  ocurrencias INT DEFAULT 1,
  ultima_vez  DATE,
  creado_por  TEXT DEFAULT 'usuario',  -- 'gemini' | 'usuario'
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(patron, unidad_id)
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_saldos_unidad     ON saldos_mensuales(unidad_id);
CREATE INDEX IF NOT EXISTS idx_saldos_periodo    ON saldos_mensuales(periodo);
CREATE INDEX IF NOT EXISTS idx_gastos_liq        ON gastos(liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_transac_liq       ON transacciones_banco(liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_patrones_unidad   ON patrones_pago(unidad_id);

-- RLS: habilitar (la app usa service_role key desde el Worker)
ALTER TABLE configuracion       ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades            ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidaciones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_mensuales    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transacciones_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrones_pago       ENABLE ROW LEVEL SECURITY;

-- Políticas: acceso total para anon (la app es privada, sin login por ahora)
-- En producción se puede restringir con Supabase Auth
CREATE POLICY "allow_all_configuracion"       ON configuracion       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_unidades"            ON unidades            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_liquidaciones"       ON liquidaciones       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_gastos"              ON gastos              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_saldos"              ON saldos_mensuales    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_transacciones"       ON transacciones_banco FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_patrones"            ON patrones_pago       FOR ALL TO anon USING (true) WITH CHECK (true);
