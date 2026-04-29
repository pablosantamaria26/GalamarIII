-- ─────────────────────────────────────────────────────────────────────────
-- 003: Tabla patrones_gasto + seed histórico completo en patrones_pago
-- ─────────────────────────────────────────────────────────────────────────

-- Tabla de patrones para clasificar débitos del extracto bancario
CREATE TABLE IF NOT EXISTS patrones_gasto (
  id        SERIAL PRIMARY KEY,
  patron    TEXT NOT NULL,
  campo     TEXT NOT NULL DEFAULT 'descripcion', -- 'descripcion' | 'ley1' | 'ley2'
  tipo      TEXT NOT NULL,   -- 'gasto_bancario' | 'gasto_edificio'
  categoria TEXT NOT NULL,   -- 'IMP_DEBITO' | 'CESOP' | 'SEGURO' | etc.
  etiqueta  TEXT,            -- label legible para mostrar en UI
  activo    BOOLEAN DEFAULT TRUE,
  UNIQUE(patron, campo)
);

ALTER TABLE patrones_gasto ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_all ON patrones_gasto FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ── Cargos bancarios (siempre se suman, nunca se asignan a unidad) ─────────
INSERT INTO patrones_gasto (patron, campo, tipo, categoria, etiqueta) VALUES
  ('Imp. Deb. Ley',                 'descripcion', 'gasto_bancario', 'IMP_DEBITO',         'Impuesto al débito (Ley 25413)'),
  ('IMP. DEB. LEY',                 'descripcion', 'gasto_bancario', 'IMP_DEBITO',         'Impuesto al débito (Ley 25413)'),
  ('Imp. Cre. Ley',                 'descripcion', 'gasto_bancario', 'IMP_CREDITO',        'Impuesto al crédito (Ley 25413)'),
  ('IMP. CRE. LEY',                 'descripcion', 'gasto_bancario', 'IMP_CREDITO',        'Impuesto al crédito (Ley 25413)'),
  ('Imp. Ing. Brutos',              'descripcion', 'gasto_bancario', 'IIBB',               'Ingresos brutos'),
  ('IMP. ING. BRUTOS',              'descripcion', 'gasto_bancario', 'IIBB',               'Ingresos brutos'),
  ('Percep. Iva',                   'descripcion', 'gasto_bancario', 'PERCEP_IVA',         'Percepción IVA'),
  ('PERCEP. IVA',                   'descripcion', 'gasto_bancario', 'PERCEP_IVA',         'Percepción IVA'),
  ('Iva',                           'descripcion', 'gasto_bancario', 'IVA',                'IVA bancario'),
  ('IVA',                           'descripcion', 'gasto_bancario', 'IVA',                'IVA bancario'),
  ('Comision Servicio',             'descripcion', 'gasto_bancario', 'COMISION_CUENTA',    'Mantenimiento de cuenta corriente'),
  ('Comision Mantenimiento',        'descripcion', 'gasto_bancario', 'COMISION_CUENTA',    'Mantenimiento de cuenta corriente'),
  ('COMISION MANTENIMIENTO',        'descripcion', 'gasto_bancario', 'COMISION_CUENTA',    'Mantenimiento de cuenta corriente'),
  ('Com. Movimientos',              'descripcion', 'gasto_bancario', 'COMISION_MOVIMIENTOS','Comisión por movimientos'),
  ('COM. MOVIMIENTOS',              'descripcion', 'gasto_bancario', 'COMISION_MOVIMIENTOS','Comisión por movimientos'),
  ('Com. Gestion Transf',           'descripcion', 'gasto_bancario', 'COMISION_TRANSF',    'Comisión transferencia entre bancos'),
  ('Com Dep Efvo',                  'descripcion', 'gasto_bancario', 'COMISION_DEPOSITO',  'Comisión depósito en efectivo'),
  ('Comision Depositos En Efectivo','descripcion', 'gasto_bancario', 'COMISION_DEPOSITO',  'Comisión depósito en efectivo'),
  ('COMISION DEPOSITOS EN EFECTIVO','descripcion', 'gasto_bancario', 'COMISION_DEPOSITO',  'Comisión depósito en efectivo'),
  ('Debito Debin',                  'descripcion', 'gasto_bancario', 'DEBIN',              'Débito inmediato (DEBIN)'),
  ('DEBITO DEBIN',                  'descripcion', 'gasto_bancario', 'DEBIN',              'Débito inmediato (DEBIN)'),
-- ── Gastos del edificio (por leyenda1 = descripción del servicio) ──────────
  ('CESOP',  'ley1', 'gasto_edificio', 'CESOP',  'CESOP – WiFi, cámaras seguridad, obras sanitarias, luz'),
  ('HOLAND', 'ley1', 'gasto_edificio', 'SEGURO', 'La Holando Sudamericana – Seguro integral del edificio'),
-- ── Gastos del edificio (por leyenda2 = etiqueta manual) ───────────────────
  ('SEGURO',  'ley2', 'gasto_edificio', 'SEGURO', 'Seguro integral del edificio'),
  ('WIFI',    'ley2', 'gasto_edificio', 'CESOP',  'CESOP – Internet WiFi cámaras'),
  ('CESOP',   'ley2', 'gasto_edificio', 'CESOP',  'CESOP – Servicios'),
  ('LIMPIEZA','ley2', 'gasto_edificio', 'LIMPIEZA','Servicio de limpieza')
ON CONFLICT (patron, campo) DO NOTHING;

-- ── Poblar patrones_pago con 4 años de historial bancario ─────────────────
-- Truncar solo los generados por "sistema" y reemplazar con datos históricos
DELETE FROM patrones_pago WHERE creado_por = 'sistema' OR creado_por IS NULL;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT * FROM (VALUES
      ('ANDUEZA/JOSE MARIA',             '5A',       9),
      ('LAMAS,ANA MARIA',                '1D',       9),
      ('RUBEN DARIO PAEZ',               '4D',      10),
      ('LAKISZ HECTOR OSVALDO',          '4A Y 4B',  9),
      ('STEYNBERG/HORACIO N',            '6A',      12),
      ('WALDMAN/ALBERTO J',              '3A',      12),
      ('MAFFEI/PAOLA VANESA',            '2D',      12),
      ('BELTRAN/ANA BEATRIZ',            '2B',       9),
      ('BELTRAN,ANA BEATRIZ',            '2B',       2),
      ('BELTRAN            ANA BEATRI',  '2B',       1),
      ('FERRO/FACUNDO M',                '7D',       4),
      ('FERRO/RICARDO J',                '7D',       3),
      ('RICARDO JAVIER FERRO',           '7D',       2),
      ('FAJARDO,MARIA FERNANDA',         '1A',       4),
      ('MARIA DEL PILAR HERRERO',        '3D',       4),
      ('ROMERO, SILVIA GRACIEL',         '2A',       8),
      ('ROMERO, SILVIA GRACIELL',        '2A',       4),
      ('PAULA PATRICIA PEREZ',           '1C',       4),
      ('LORENA PAOLA ANDRADE',           '3C',       5),
      ('GRACIELA LAURA GUTIERREZ',       '5D',       3),
      ('GUTIERREZ GRACIELA LAU',         '5D',       3),
      ('GUTIERREZ GRACIELA LAUU',        '5D',       3),
      ('GUTIERREZ, GRACIELA LAA',        '5D',       1),
      ('MARINA SOLEDAD CASADO',          'PORTERIA', 5),
      ('CASADO, MARINA SOLEDAD',         'PORTERIA', 1),
      ('HERNAN JOEL ZURAVSKY SKVERER',   '1B',       4),
      ('Claudia Graciela Aggollia',      '1B',       1),
      ('DANIELA DENISE BOROV',           '1B',       1),
      ('VILAPLANA ANA',                  '4C',       2),
      ('VILAPLANA,ANA',                  '4C',       1),
      ('CENDON, OSCAR',                  '5C',       4),
      ('OSCAR CENDON',                   '5C',       1),
      ('BOUZON, ANA CRISTINA',           '5C',       2),
      ('ANA CRISTINA BOUZON',            '5C',       1),
      ('CHUMBA/MARCELO DARIO',           '3C',       4),
      ('WAINER/DARIO A',                 '1C',       5),
      ('IERULLO,BELEN ALEJANDRR',        '7C',       4),
      ('HINDI, BARBARA ANDREA',          'LOCAL 1',  4),
      ('CELESTE QUINTEROS',              'LOCAL 1',  5),
      ('ROMERO/DORA G',                  '7B',       5),
      ('GRACIELA DOR ROMERO',            '7B',       1),
      ('27134324606',                    '7B',       1),
      ('JORGE NORBERTO CORDON',          '4C',       2),
      ('JORGE NORBERTO CORDO',           '4C',       1),
      ('BEATRIZ COUCEIRO',               '9B',       4),
      ('MIRABETTO/JORGE A',              '2C',       1),
      ('ALEJANDRA ELIZABETH',            '2C',       1),
      ('GONZALEZ/ROLDAN VERONICA',       '5B',       1),
      ('Veronica Elena Gonzalez Roldan', '5B',       3),
      ('GUIDO GUILLERMO MOLINA VILLAROEL','7A',       3),
      ('CLAUDIO FABIAN MOLINA HERRERO',  '7A',       2),
      ('SANTAMARIA/PABLO D',             'ADMINISTRACION', 2),
      ('MARIA DEL CARMEN CON',           '7C',       1)
    ) AS v(patron, codigo, ocurrencias)
  ) LOOP
    INSERT INTO patrones_pago (patron, unidad_id, ocurrencias, creado_por)
    SELECT r.patron, u.id, r.ocurrencias, 'sistema'
    FROM unidades u WHERE u.codigo = r.codigo
    ON CONFLICT (patron, unidad_id) DO UPDATE SET ocurrencias = EXCLUDED.ocurrencias;
  END LOOP;
END $$;
