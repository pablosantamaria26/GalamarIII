-- ============================================================
-- SEED: Datos iniciales - Galamar III
-- Extraídos de Liquidacion Expensas Marzo 2026.xlsx
-- ============================================================

-- ── Configuración global ─────────────────────────────────────
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('nombre_edificio',     'Galamar III',                    'Nombre del consorcio'),
  ('direccion',           'San Bernardo',                   'Dirección del edificio'),
  ('cuit',                '30-66779562-8',                  'CUIT del consorcio'),
  ('banco',               'Banco Galicia',                  'Banco del consorcio'),
  ('cuenta_nro',          '9067-2 044-0',                   'Número de cuenta bancaria'),
  ('cbu',                 '0070044320000009067200',          'CBU para transferencias'),
  ('alias',               'GALAMAR3',                       'Alias bancario'),
  ('precio_cochera',      '1116',                           'Valor mensual de cada cochera ($)'),
  ('tasa_interes',        '4.5',                            'Tasa de interés mensual sobre saldo deudor (%)'),
  ('administrador',       'Pablo Santamaria',               'Nombre del administrador'),
  ('precio_tipo_AD',      '48620',                          'Precio base deptos tipo A y D'),
  ('precio_tipo_BC',      '40205',                          'Precio base deptos tipo B y C'),
  ('precio_pb_local1',    '24310',                          'Precio PB Local 1'),
  ('precio_pb_local2',    '61710',                          'Precio PB Local 2'),
  ('precio_9piso',        '98604',                          'Precio base deptos 9° piso (sin cocheras)'),
  ('dia_vencimiento',     '12',                             'Día del mes para vencimiento de expensas'),
  ('saldo_caja_actual',   '3105888.19',                     'Saldo en caja al cierre de Marzo 2026')
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;

-- ── Unidades (35 total) ──────────────────────────────────────
-- Saldo inicial = saldo_pendiente al cierre de Marzo 2026
-- Los saldos positivos son DEUDA, negativos son CRÉDITO a favor

INSERT INTO unidades (codigo, tipo, precio_base, cocheras, orden) VALUES
-- Planta baja
('PB Local 1',  'local',  24310, '{}',       1),
('PB Local 2',  'local',  61710, '{}',       2),
-- 1° piso
('1°A',         'AD',     48620, '{}',       3),
('1°B',         'BC',     40205, '{}',       4),
('1°C',         'BC',     40205, '{}',       5),
('1°D',         'AD',     48620, '{}',       6),
-- 2° piso
('2°A',         'AD',     48620, '{}',       7),
('2°B',         'BC',     40205, '{}',       8),
('2°C',         'BC',     40205, '{}',       9),
('2°D',         'AD',     48620, '{9}',      10),
-- 3° piso
('3°A',         'AD',     48620, '{}',       11),
('3°B',         'BC',     40205, '{}',       12),
('3°C',         'BC',     40205, '{}',       13),
('3°D',         'AD',     48620, '{5}',      14),
-- 4° piso
('4°A',         'AD',     48620, '{6}',      15),
('4°B',         'BC',     40205, '{}',       16),
('4°C',         'BC',     40205, '{}',       17),
('4°D',         'AD',     48620, '{}',       18),
-- 5° piso
('5°A',         'AD',     48620, '{10}',     19),
('5°B',         'BC',     40205, '{}',       20),
('5°C',         'BC',     40205, '{}',       21),
('5°D',         'AD',     48620, '{7}',      22),
-- 6° piso
('6°A',         'AD',     48620, '{11}',     23),
('6°B',         'BC',     40205, '{}',       24),
('6°C',         'BC',     40205, '{}',       25),
('6°D',         'AD',     48620, '{1}',      26),
-- 7° piso
('7°A',         'AD',     48620, '{3}',      27),
('7°B',         'BC',     40205, '{}',       28),
('7°C',         'BC',     40205, '{}',       29),
('7°D',         'AD',     48620, '{2}',      30),
-- 8° piso
('8°A',         'AD',     48620, '{4}',      31),
('8°B',         'BC',     40205, '{8}',      32),
('8°C',         'BC',     40205, '{12}',     33),
('8°D',         'AD',     48620, '{13}',     34),
-- 9° piso (unidades dobles con 2 cocheras cada una)
('9°A',         '9piso',  98604, '{14,15}',  35),
('9°B',         '9piso',  98604, '{16,17}',  36)
ON CONFLICT (codigo) DO NOTHING;

-- ── Liquidación de Marzo 2026 (cerrada) ─────────────────────
INSERT INTO liquidaciones (
  periodo, estado,
  saldo_caja_anterior,
  ingreso_alquiler_pb, ingreso_luz_porteria,
  total_ingresos, total_egresos, saldo_caja_final,
  fecha_vencimiento
) VALUES (
  '2026-03-01', 'publicada',
  5238719.87,
  130000, 18141.15,
  1549760, 3830732.83, 3105888.19,
  '2026-03-12'
) ON CONFLICT (periodo) DO NOTHING;

-- ── Saldos de cada unidad al cierre de Marzo 2026 ───────────
-- Estos son los saldos_finales que se convierten en saldo_anterior de Abril
-- saldo_final = saldo_pendiente después de los pagos de Marzo

DO $$
DECLARE
  liq_id UUID;
BEGIN
  SELECT id INTO liq_id FROM liquidaciones WHERE periodo = '2026-03-01';

  INSERT INTO saldos_mensuales (unidad_id, liquidacion_id, periodo, saldo_anterior, expensa_mes, gastos_particulares, pagos, punitorios, saldo_final)
  SELECT u.id, liq_id, '2026-03-01',
    v.saldo_ant, v.expensa, v.gastos_part, v.pagos, v.punitorios,
    -- saldo_final = lo que quedó sin pagar (será saldo_anterior del mes siguiente)
    GREATEST(0, v.saldo_ant - v.pagos) + v.punitorios
  FROM unidades u
  JOIN (VALUES
    ('PB Local 1', 24310.00,    24310.00,      0.00,  24310.00,  0.00),
    ('PB Local 2', 61710.00,    61710.00,      0.00,      0.00,  2776.95),
    ('1°A',        48620.00,    48620.00,      0.00,  48620.00,  0.00),
    ('1°B',        40205.00,   103111.50,      0.00,      0.00,  4640.02),
    ('1°C',        40205.00,    40205.00,      0.00,  40205.00,  0.00),
    ('1°D',        48620.00,    48620.00,      0.00,  48620.00,  0.00),
    ('2°A',        48620.00,    48620.00,      0.00,  48620.00,  0.00),
    ('2°B',        40205.00,    40205.00,      0.00,  40205.00,  0.00),
    ('2°C',        40205.00,    40205.00,      0.00,  40205.00,  0.00),
    ('2°D',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('3°A',        48620.00,    48620.00,      0.00,  48620.00,  0.00),
    ('3°B',        40205.00,    39245.00,      0.00,  39300.00,  0.00),
    ('3°C',        40205.00,   202472.15,      0.00,  90000.00,  5061.25),
    ('3°D',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('4°A',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('4°B',        40205.00,    40205.00,      0.00,  40205.00,  0.00),
    ('4°C',        40205.00,    40205.00,      0.00,  40205.00,  0.00),
    ('4°D',        48620.00,    48620.00,      0.00,  48620.00,  0.00),
    ('5°A',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('5°B',        40205.00,   126124.34,      0.00,      0.00,  5675.60),
    ('5°C',        40205.00,    40205.00,      0.00,  80410.00,  0.00),
    ('5°D',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('6°A',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('6°B',        40205.00,    40205.00,      0.00,  40205.00,  0.00),
    ('6°C',        40205.00,   126124.44,      0.00,      0.00,  5675.60),
    ('6°D',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('7°A',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('7°B',        40205.00,   301665.84,      0.00,      0.00, 13574.96),
    ('7°C',        40205.00,   172004.67,      0.00,      0.00,  7740.21),
    ('7°D',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('8°A',        49736.00,    49736.00,  90000.00,  49736.00,  0.00),
    ('8°B',        41321.00,    41321.00,  90000.00,  41321.00,  0.00),
    ('8°C',        41321.00,    41321.00,  90000.00,  41321.00,  0.00),
    ('8°D',        49736.00,    49736.00,      0.00,  49736.00,  0.00),
    ('9°A',       100836.00,   100836.00,      0.00, 100836.00,  0.00),
    ('9°B',       100836.00,   100836.00,      0.00, 100836.00,  0.00)
  ) AS v(codigo, expensa, saldo_ant, gastos_part, pagos, punitorios)
  ON u.codigo = v.codigo
  ON CONFLICT (unidad_id, periodo) DO NOTHING;
END $$;

-- ── Egresos de Marzo 2026 ────────────────────────────────────
DO $$
DECLARE liq_id UUID;
BEGIN
  SELECT id INTO liq_id FROM liquidaciones WHERE periodo = '2026-03-01';

  INSERT INTO gastos (liquidacion_id, proveedor, descripcion, monto, categoria, es_recurrente, aplica_a) VALUES
  -- Servicios
  (liq_id, 'CESOP',    'Período consumo 17/12/25 - 14/01/26. FC N° 627485/652348', 290636.10, 'servicios',       true,  'todos'),
  (liq_id, 'GADE',     'Mantenimiento Ascensor: ENERO 2026',                        82500.00, 'servicios',       true,  'todos'),
  (liq_id, 'CESOP',    'Abono Internet cámaras de seguridad FC: 1265995',           23000.00, 'servicios',       true,  'todos'),
  -- Mantenimiento
  (liq_id, 'Marcelo Abrigo',     'Servicio integral de limpieza turno mañana - FC N:2788 - Feb 2026',                                                       768900.00, 'mantenimiento', true,  'todos'),
  (liq_id, 'Marcelino Benítez',  'Reparación pared sector escalera entre 1er piso y PB',                                                                      60000.00, 'mantenimiento', false, 'todos'),
  (liq_id, 'Marcelino Benítez',  'Trabajos reparación cochera: picado columnas/vigas + reconstrucción hormigón. Incluye materiales y MO',                   1080000.00, 'mantenimiento', false, 'cocheras'),
  (liq_id, 'Bobinados Norte',    'Reparación e instalación 2da bomba centrífuga elevadora de agua',                                                           580000.00, 'mantenimiento', false, 'todos'),
  (liq_id, 'Nanci Zalasar',      'Servicio limpieza espacios comunes, cochera y plantas. Turno tarde. Marzo 2026 (último mes)',                               320000.00, 'mantenimiento', false, 'todos'),
  -- Seguro
  (liq_id, 'La Holando Sudamericana', 'Seguro integral consorcio', 194188.94, 'seguro',          true,  'todos'),
  -- Administrativo
  (liq_id, 'Administración',     'Honorarios: Febrero 2025',                                                                                                  320000.00, 'administrativo', true,  'todos'),
  -- Bancario
  (liq_id, 'Débitos Bancarios',  'Mantenimiento cta cte Banco Galicia. Comisión, cargos, imp. débito/crédito, IVA, Ley 25413, II.BB',                        111507.79, 'bancario',       false, 'todos')
  ON CONFLICT DO NOTHING;
END $$;

-- ── Patrones de pago conocidos (del historial bancario) ──────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT * FROM (VALUES
      ('CHUMBA',         '3°C',       5),
      ('WALDMAN',        '2°A',       8),
      ('BELTRAN',        '1°A',       6),
      ('ROMERO',         '4°B',       7),
      ('STEYNBERG',      '5°D',       4),
      ('PAEZ',           '6°A',       9),
      ('MAFFEI',         '7°B',       3),
      ('GUTIERREZ',      '8°C',       5),
      ('LAMAS',          '3°A',       6),
      ('HINDI',          'PB Local 2',4),
      ('LOCAL CALEGARI', 'PB Local 1',8),
      ('BEATRIZ',        '1°A',       3),
      ('DORA',           '4°C',       2),
      ('GENARO',         '2°B',       4)
    ) AS t(patron, codigo, ocurrencias)
  ) LOOP
    INSERT INTO patrones_pago (patron, unidad_id, ocurrencias, ultima_vez, creado_por)
    SELECT r.patron, u.id, r.ocurrencias, '2026-03-31'::DATE, 'usuario'
    FROM unidades u WHERE u.codigo = r.codigo
    ON CONFLICT (patron, unidad_id) DO NOTHING;
  END LOOP;
END $$;
