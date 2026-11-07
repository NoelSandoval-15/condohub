-- =====================================================================
-- CondoHub · Gestión · Ampliación de datos de demostración (sintéticos)
-- Se aplica DESPUÉS de la semilla R__datos_demo.sql (200 unidades, expensas ago–oct, 60 morosos en B y C).
-- Idempotente: si ya existe el proveedor NIT-1005, no hace nada. No toca migraciones ni código.
-- Respeta F2 (alícuotas), F6 (ningún cargo se borra ni cambia de monto), F7 (solo pagos CONFIRMADOS se imputan),
-- F8 (recibo solo al confirmar; rechazo con motivo) y F9 (nada se confirma sin revisión). Nada de recargos confirmados (F5).
-- Uso: node infra/datos-demo/poblar-demo.mjs   (lo ejecuta en una sola transacción)
-- =====================================================================
DO $$
DECLARE
    v_admin CONSTANT VARCHAR := '00000000-0000-0000-0000-00000000a001';
    v_hoy   CONSTANT DATE    := current_date;
    r       RECORD;
    v_pago  UUID;
    v_parcial NUMERIC(12,2);
BEGIN
    IF EXISTS (SELECT 1 FROM proveedor WHERE documento = 'NIT-1005') THEN
        RAISE NOTICE 'Ampliación de demostración ya aplicada: no se hace nada';
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unidad WHERE codigo = 'D-101') THEN
        RAISE EXCEPTION 'Falta la semilla de demostración (200 unidades): arranca Gestión con el perfil dev';
    END IF;

    -- -----------------------------------------------------------------
    -- 1. Morosidad también en los bloques A y D (hoy solo B y C).
    --    Se reabren expensas que la semilla marcó pagadas: se deshace SOLO el pago sembrado ('seed') y el cargo
    --    vuelve a pendiente con su monto original (F6 permite cambiar saldo y estado, nunca el monto).
    -- -----------------------------------------------------------------
    CREATE TEMP TABLE _deuda (codigo TEXT, periodo DATE) ON COMMIT DROP;
    INSERT INTO _deuda
    SELECT 'A-' || (100 + n), DATE '2026-10-01' FROM generate_series(11, 16) n                 -- 1 vencida
    UNION ALL SELECT 'A-' || (100 + n), p FROM generate_series(31, 33) n,
              unnest(ARRAY[DATE '2026-08-01', DATE '2026-09-01', DATE '2026-10-01']) p         -- 3 vencidas (R4)
    UNION ALL SELECT 'D-' || (100 + n), p FROM generate_series(21, 26) n,
              unnest(ARRAY[DATE '2026-09-01', DATE '2026-10-01']) p                            -- 2 vencidas (R4)
    UNION ALL SELECT 'D-' || (100 + n), DATE '2026-10-01' FROM generate_series(33, 37) n;      -- 1 vencida

    FOR r IN
        SELECT c.id AS cargo_id
        FROM _deuda d
        JOIN unidad u ON u.codigo = d.codigo
        JOIN periodo_expensas pe ON pe.periodo = d.periodo
        JOIN cargo c ON c.unidad_id = u.id AND c.periodo_id = pe.id AND c.tipo = 'EXPENSA'
        WHERE c.estado = 'PAGADO'
    LOOP
        FOR v_pago IN
            SELECT i.pago_id FROM imputacion_pago i JOIN pago p ON p.id = i.pago_id
            WHERE i.cargo_id = r.cargo_id AND p.registrado_por = 'seed'
        LOOP
            DELETE FROM recibo WHERE pago_id = v_pago;
            DELETE FROM imputacion_pago WHERE pago_id = v_pago;
            DELETE FROM pago WHERE id = v_pago;
        END LOOP;
        UPDATE cargo SET saldo = monto, estado = 'PENDIENTE' WHERE id = r.cargo_id;
    END LOOP;

    -- Pagos parciales (F7): tres unidades de A pagaron la mitad de octubre
    FOR r IN
        SELECT c.id, c.unidad_id, c.monto
        FROM unidad u
        JOIN cargo c ON c.unidad_id = u.id
        JOIN periodo_expensas pe ON pe.id = c.periodo_id AND pe.periodo = DATE '2026-10-01'
        WHERE u.codigo IN ('A-111', 'A-112', 'A-113') AND c.estado = 'PENDIENTE'
    LOOP
        v_parcial := round(r.monto / 2, 2);
        INSERT INTO pago (unidad_id, monto, fecha_pago, banco, nro_operacion, estado, idempotency_key,
                          registrado_por, registrado_en, revisado_por, revisado_en)
        VALUES (r.unidad_id, v_parcial, DATE '2026-10-22', 'Banco Unión', 'OP-PARC-' || substr(r.id::text, 1, 8),
                'CONFIRMADO', gen_random_uuid(), 'demo', DATE '2026-10-22', v_admin, DATE '2026-10-23')
        RETURNING id INTO v_pago;
        INSERT INTO imputacion_pago (pago_id, cargo_id, monto) VALUES (v_pago, r.id, v_parcial);
        UPDATE cargo SET saldo = r.monto - v_parcial WHERE id = r.id;
        INSERT INTO recibo (pago_id, emitido_en) VALUES (v_pago, DATE '2026-10-23');
    END LOOP;

    -- -----------------------------------------------------------------
    -- 2. Noviembre al día para quien no debe nada anterior (solo si el periodo ya está emitido). Sin esto, el 11/11
    --    todas las unidades pasarían a morosas a la vez y el reporte de morosidad quedaría inservible.
    -- -----------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM periodo_expensas WHERE periodo = DATE '2026-11-01' AND estado = 'EMITIDO') THEN
        FOR r IN
            SELECT c.id, c.unidad_id, c.monto, c.fecha_vencimiento, (substr(u.codigo, 3)::int - 100) AS nro
            FROM cargo c
            JOIN unidad u ON u.id = c.unidad_id
            JOIN periodo_expensas pe ON pe.id = c.periodo_id AND pe.periodo = DATE '2026-11-01'
            WHERE c.estado = 'PENDIENTE'
              AND NOT EXISTS (SELECT 1 FROM cargo o WHERE o.unidad_id = c.unidad_id AND o.estado = 'PENDIENTE'
                                AND o.fecha_vencimiento < v_hoy)
              AND NOT (u.bloque = 'A' AND substr(u.codigo, 3)::int - 100 BETWEEN 1 AND 4)     -- unidades de la demo en vivo
              AND (substr(u.codigo, 3)::int % 4 <> 0 OR u.codigo IN ('A-140', 'A-141', 'A-142'))
        LOOP
            INSERT INTO pago (unidad_id, monto, fecha_pago, banco, nro_operacion, estado, idempotency_key,
                              registrado_por, registrado_en, revisado_por, revisado_en)
            VALUES (r.unidad_id, r.monto, LEAST(DATE '2026-11-02' + (r.nro % 4), v_hoy), 'Banco Mercantil Santa Cruz',
                    'OP-NOV-' || substr(r.id::text, 1, 8), 'CONFIRMADO', gen_random_uuid(), 'demo',
                    LEAST(DATE '2026-11-02' + (r.nro % 4), v_hoy), v_admin, LEAST(DATE '2026-11-03' + (r.nro % 4), v_hoy))
            RETURNING id INTO v_pago;
            INSERT INTO imputacion_pago (pago_id, cargo_id, monto) VALUES (v_pago, r.id, r.monto);
            UPDATE cargo SET saldo = 0, estado = 'PAGADO' WHERE id = r.id;
            INSERT INTO recibo (pago_id, emitido_en) VALUES (v_pago, LEAST(DATE '2026-11-03' + (r.nro % 4), v_hoy));
        END LOOP;
    END IF;

    -- Saldo a favor (F7): tres unidades al día pagaron de más; el excedente queda sin imputar
    FOR r IN SELECT id FROM unidad WHERE codigo IN ('A-140', 'A-141', 'A-142') LOOP
        INSERT INTO pago (unidad_id, monto, fecha_pago, banco, nro_operacion, estado, idempotency_key,
                          registrado_por, registrado_en, revisado_por, revisado_en)
        VALUES (r.id, 500.00, LEAST(DATE '2026-11-04', v_hoy), 'Banco Ganadero', 'OP-ADEL-' || substr(r.id::text, 1, 8),
                'CONFIRMADO', gen_random_uuid(), 'demo', LEAST(DATE '2026-11-04', v_hoy), v_admin, LEAST(DATE '2026-11-05', v_hoy))
        RETURNING id INTO v_pago;
        INSERT INTO recibo (pago_id, emitido_en) VALUES (v_pago, LEAST(DATE '2026-11-05', v_hoy));
    END LOOP;

    -- -----------------------------------------------------------------
    -- 3. Conciliación (F8): 8 pagos pendientes con OCR creíble y 4 rechazados con motivo
    -- -----------------------------------------------------------------
    INSERT INTO pago (unidad_id, monto, fecha_pago, banco, nro_operacion, estado, idempotency_key, registrado_por,
                      registrado_en, hora_dispositivo, datos_ocr)
    SELECT u.id, 270.00, LEAST(DATE '2026-11-01' + (n % 5), v_hoy),
           (ARRAY['Banco Unión', 'BNB', 'Mercantil Santa Cruz', 'BCP', 'Banco Ganadero'])[1 + n % 5],
           'OP-DEMO-' || u.codigo, 'PENDIENTE', gen_random_uuid(), 'demo',
           LEAST(DATE '2026-11-01' + (n % 5), v_hoy) + time '10:15', LEAST(DATE '2026-11-01' + (n % 5), v_hoy) + time '10:14',
           jsonb_build_object('monto', '270.00', 'fecha', to_char(LEAST(DATE '2026-11-01' + (n % 5), v_hoy), 'YYYY-MM-DD'),
                              'banco', (ARRAY['Banco Unión', 'BNB', 'Mercantil Santa Cruz', 'BCP', 'Banco Ganadero'])[1 + n % 5],
                              'confianza', round((0.78 + (n % 8) * 0.026)::numeric, 3))
    FROM generate_series(5, 8) n
    CROSS JOIN unnest(ARRAY['B', 'C']) b
    JOIN unidad u ON u.codigo = b || '-' || (100 + n);

    INSERT INTO pago (unidad_id, monto, fecha_pago, banco, nro_operacion, estado, motivo_rechazo, idempotency_key,
                      registrado_por, registrado_en, revisado_por, revisado_en)
    SELECT u.id, 270.00, DATE '2026-10-28', 'BNB', 'OP-RECH-' || u.codigo, 'RECHAZADO', m.motivo, gen_random_uuid(),
           'demo', DATE '2026-10-28', v_admin, DATE '2026-10-29'
    FROM (VALUES ('B-109', 'Comprobante ilegible: no se distingue el monto'),
                 ('B-110', 'El monto no coincide con el extracto bancario'),
                 ('C-109', 'La operación ya fue registrada en otro pago'),
                 ('C-110', 'La fecha del comprobante no corresponde a la operación')) AS m(codigo, motivo)
    JOIN unidad u ON u.codigo = m.codigo;

    -- -----------------------------------------------------------------
    -- 4. Recargos propuestos (F5): 10, mezcla de sistema y agente. NINGUNO confirmado: lo decide el ADMIN.
    -- -----------------------------------------------------------------
    INSERT INTO recargo_propuesto (unidad_id, cargo_origen_id, periodo, porcentaje, base, monto, estado, origen, motivo)
    SELECT c.unidad_id, c.id, DATE '2026-11-01', 2.00, c.saldo, round(c.saldo * 0.02, 2), 'PROPUESTO',
           (CASE WHEN (substr(u.codigo, 3)::int) % 2 = 0 THEN 'AGENTE' ELSE 'SISTEMA' END)::origen_propuesta,
           'Saldo vencido de ' || c.concepto
    FROM unidad u
    JOIN LATERAL (SELECT c2.* FROM cargo c2
                  WHERE c2.unidad_id = u.id AND c2.tipo = 'EXPENSA' AND c2.estado = 'PENDIENTE' AND c2.fecha_vencimiento < v_hoy
                  ORDER BY c2.fecha_vencimiento LIMIT 1) c ON true
    WHERE u.codigo IN ('B-111', 'B-112', 'B-113', 'B-114', 'B-115', 'C-111', 'C-112', 'C-113', 'C-114', 'C-115')
    ON CONFLICT (cargo_origen_id, periodo) DO NOTHING;

    -- -----------------------------------------------------------------
    -- 5. Proveedores y egresos (F11) hasta noviembre, para los reportes de gasto del periodo
    -- -----------------------------------------------------------------
    INSERT INTO proveedor (nombre, documento, rubro, contacto) VALUES
        ('Piscinas Cristal', 'NIT-1005', 'Mantenimiento de piscina', 'contacto@piscinas.test'),
        ('Seguros Andes',    'NIT-1006', 'Seguros',                  'contacto@seguros.test');
    INSERT INTO egreso (proveedor_id, periodo, concepto, monto, fecha, registrado_por)
    SELECT pr.id, m, 'Servicio ' || pr.rubro || ' ' || to_char(m, 'MM/YYYY'),
           CASE pr.rubro WHEN 'Seguridad' THEN 28000 WHEN 'Limpieza' THEN 14000 WHEN 'Jardinería' THEN 6000
                         WHEN 'Energía' THEN 9000 WHEN 'Seguros' THEN 1000 ELSE 1500 END,
           LEAST(m + 25, v_hoy), v_admin
    FROM proveedor pr CROSS JOIN unnest(ARRAY[DATE '2026-08-01', DATE '2026-09-01', DATE '2026-10-01', DATE '2026-11-01']) m
    WHERE NOT EXISTS (SELECT 1 FROM egreso e WHERE e.proveedor_id = pr.id AND e.periodo = m);
END $$;
