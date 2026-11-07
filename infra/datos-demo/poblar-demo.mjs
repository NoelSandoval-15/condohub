#!/usr/bin/env node
// Pobla CondoHub con datos sintéticos coherentes para la demostración (reportes de morosidad, conciliación, recargos, reservas).
//   Uso:  node infra/datos-demo/poblar-demo.mjs            (sistema LOCAL, contenedores del compose)
//         node infra/datos-demo/poblar-demo.mjs --nube     (Gestión en la VM de Azure y Reservas en la de Google, por SSH)
// Es idempotente: se puede correr dos veces. Orden: 1) Gestión (gestion.sql: morosidad, pagos, recargos, egresos);
// 2) Reservas (reservas con su saga ya completada, sin invitados, así que no necesitan pases de Acceso);
// 3) los cargos de esas reservas en Gestión (R5, R6, R7). Nunca se edita ni se borra un cargo (F6).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const NUBE = process.argv.includes('--nube');
const ADMIN_SUB = '00000000-0000-0000-0000-00000000a001';

const psql = (bd, extra) => `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${bd} ${extra}`;
function ejecutor(contenedor, ssh) {
  return (bd, sql, extra = '') => {
    const cmd = psql(bd, extra);
    const [bin, args] = ssh
      ? ['ssh', ['-o', 'BatchMode=yes', '-i', join(homedir(), '.ssh', ssh.clave), ssh.host, `docker exec -i ${contenedor} sh -c '${cmd}'`]]
      : ['docker', ['exec', '-i', contenedor, 'sh', '-c', cmd]];
    const r = spawnSync(bin, args, { input: sql, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`${bd}: ${r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
}
const enGestion = NUBE ? ejecutor('condohub-postgres-1', { host: 'azureuser@68.211.120.83', clave: 'condohub-azure_key.pem' }) : ejecutor('condohub-postgres-1');
const enReservas = NUBE ? ejecutor('gcp-postgres-1', { host: 'luis@35.232.160.36', clave: 'condohub-gcp' }) : ejecutor('condohub-postgres-1');

/** UUID estable por nombre: correr el script dos veces no duplica nada. */
function uuid(nombre) {
  const h = createHash('sha1').update(`condohub-demo:${nombre}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
/** O1: la Idempotency-Key debe ser UUID v4; mismo cálculo estable, con la versión 4. */
const uuidV4 = (nombre) => uuid(nombre).replace(/^(.{14})5/, '$14');
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const vence = (emision) => {
  const d = new Date(`${emision}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 10)).toISOString().slice(0, 10);
};

// clave, área, unidad, día de la reserva, día en que se pidió, estado, ¿con daños?, hora de inicio y fin (UTC)
const HORARIO = { SALON: ['14:00', '20:00'], PISCINA: ['15:00', '19:00'], 'CHURR-1': ['18:00', '22:00'], 'CHURR-2': ['18:00', '22:00'] };
const RESERVAS = [
  ['f1', 'SALON', 'A-120', '2026-10-03', '2026-10-01', 'FINALIZADA', false],
  ['f2', 'SALON', 'D-110', '2026-10-17', '2026-10-15', 'FINALIZADA', true],
  ['f3', 'CHURR-1', 'B-135', '2026-10-10', '2026-10-08', 'FINALIZADA', false],
  ['f4', 'PISCINA', 'C-140', '2026-10-24', '2026-10-22', 'FINALIZADA', false],
  ['f5', 'CHURR-2', 'D-145', '2026-10-31', '2026-10-29', 'FINALIZADA', false],
  ['c1', 'SALON', 'A-130', '2026-11-14', '2026-11-04', 'CONFIRMADA'],
  ['c2', 'SALON', 'C-130', '2026-11-28', '2026-11-03', 'CONFIRMADA'],
  ['c3', 'CHURR-1', 'D-150', '2026-11-15', '2026-11-05', 'CONFIRMADA'],
  ['c4', 'CHURR-2', 'B-140', '2026-11-22', '2026-11-02', 'CONFIRMADA'],
  ['c5', 'PISCINA', 'A-125', '2026-11-21', '2026-11-04', 'CONFIRMADA'],
  ['c6', 'SALON', 'D-130', '2026-12-12', '2026-11-05', 'CONFIRMADA'],
  ['c7', 'CHURR-1', 'C-145', '2026-12-05', '2026-11-01', 'CONFIRMADA'],
  ['x1', 'CHURR-1', 'A-135', '2026-11-18', '2026-11-01', 'CANCELADA'],
  ['x2', 'SALON', 'C-135', '2026-12-19', '2026-11-02', 'CANCELADA'],
];
const NOMBRE_AREA = { SALON: 'SALON', PISCINA: 'PISCINA', 'CHURR-1': 'CHURR-1', 'CHURR-2': 'CHURR-2' };

console.log(`Destino: ${NUBE ? 'NUBE (Azure y Google)' : 'local'}`);

console.log('1) Gestión: morosidad, pagos, recargos y egresos…');
enGestion('gestion', readFileSync(join(aqui, 'gestion.sql'), 'utf8'));

console.log('2) Leyendo unidades y áreas…');
const unidades = new Map(
  enGestion('gestion', "select u.codigo, u.id, u.propietario_titular_id from unidad u", '-At -F "|"')
    .split('\n').map((l) => l.split('|')).map(([codigo, id, titular]) => [codigo, { id, titular }]),
);
const areas = new Map(
  enReservas('reservas', 'select codigo, costo_uso, garantia from area_comun', '-At -F "|"')
    .split('\n').map((l) => l.split('|')).map(([codigo, uso, garantia]) => [codigo, { uso: Number(uso), garantia: Number(garantia) }]),
);

const sqlReservas = [];
const sqlCargos = [];
for (const [clave, area, codigoUnidad, dia, pedida, estado, danios] of RESERVAS) {
  const u = unidades.get(codigoUnidad);
  const a = areas.get(area);
  if (!u || !a) throw new Error(`Falta la unidad ${codigoUnidad} o el área ${area}`);
  const id = uuid(`reserva:${clave}`);
  const saga = uuid(`saga:${clave}`);
  const [hi, hf] = HORARIO[area];
  const creada = `${pedida}T15:00:00Z`;
  const cierre = `${pedida}T15:00:30Z`;
  const motivo = estado === 'CANCELADA' ? 'Cancelada por el residente con más de 48 h de anticipación (R7)' : null;
  const cargoUso = a.uso > 0 ? uuid(`cargo:${clave}:uso`) : null;
  const cargoGar = a.garantia > 0 ? uuid(`cargo:${clave}:garantia`) : null;
  const ids = [cargoUso, cargoGar].filter(Boolean);

  sqlReservas.push(`
INSERT INTO reserva (id, area_id, unidad_id, solicitada_por, inicio, fin, cantidad_invitados, estado, costo_uso, garantia,
                     con_danios, motivo, idempotency_key, creada_en, actualizada_en)
SELECT ${q(id)}, ar.id, ${q(u.id)}, ${q(u.titular)}, ${q(`${dia}T${hi}:00Z`)}, ${q(`${dia}T${hf}:00Z`)}, 0, ${q(estado)},
       ar.costo_uso, ar.garantia, ${danios === undefined ? 'NULL' : danios}, ${motivo ? q(motivo) : 'NULL'}, ${q(uuidV4(`idem:${clave}`))},
       ${q(creada)}, ${q(cierre)}
FROM area_comun ar WHERE ar.codigo = ${q(area)} AND NOT EXISTS (SELECT 1 FROM reserva WHERE id = ${q(id)});
UPDATE reserva SET idempotency_key = ${q(uuidV4(`idem:${clave}`))} WHERE id = ${q(id)} AND idempotency_key <> ${q(uuidV4(`idem:${clave}`))};
INSERT INTO saga_instancia (id, reserva_id, estado, paso_actual, contexto, creada_en, actualizada_en, terminada_en)
SELECT ${q(saga)}, ${q(id)}, 'COMPLETADA', 4,
       ${q(JSON.stringify({ pases: [], cargoIds: ids, unidadCodigo: codigoUnidad }))}::jsonb, ${q(creada)}, ${q(cierre)}, ${q(cierre)}
WHERE EXISTS (SELECT 1 FROM reserva WHERE id = ${q(id)}) AND NOT EXISTS (SELECT 1 FROM saga_instancia WHERE reserva_id = ${q(id)});
INSERT INTO saga_paso (saga_id, numero, nombre, estado, intentos, actualizado_en)
SELECT ${q(saga)}, p.n, p.nombre, p.estado::estado_paso, CASE WHEN p.estado = 'OMITIDO' THEN 0 ELSE 1 END, ${q(cierre)}
FROM (VALUES (1, 'BLOQUEAR_HORARIO', 'OK'), (2, 'APLICAR_CARGOS', 'OK'), (3, 'EMITIR_PASES', 'OMITIDO'), (4, 'NOTIFICAR', 'OK')) AS p(n, nombre, estado)
WHERE EXISTS (SELECT 1 FROM saga_instancia WHERE id = ${q(saga)}) ON CONFLICT DO NOTHING;`);

  // Cargos en Gestión (R5): vencen el 10 del mes siguiente a su aplicación
  const piezas = [
    ['USO_AREA', cargoUso, a.uso, `Uso de ${NOMBRE_AREA[area]}`],
    ['GARANTIA', cargoGar, a.garantia, `Garantía de ${NOMBRE_AREA[area]}`],
  ];
  for (const [tipo, cargoId, monto, concepto] of piezas) {
    if (!cargoId) continue;
    const devuelta = tipo === 'GARANTIA' && estado === 'FINALIZADA' && danios === false; // R6
    const anulado = estado === 'CANCELADA' || devuelta;
    sqlCargos.push(`
INSERT INTO cargo (id, unidad_id, tipo, concepto, monto, saldo, estado, fecha_emision, fecha_vencimiento, referencia_externa)
SELECT ${q(cargoId)}, ${q(u.id)}, ${q(tipo)}::tipo_cargo, ${q(concepto)}, ${monto}, ${anulado ? 0 : monto},
       ${q(anulado ? 'ANULADO' : 'PENDIENTE')}::estado_cargo, ${q(pedida)}, ${q(vence(pedida))}, ${q(id)}
WHERE NOT EXISTS (SELECT 1 FROM cargo WHERE referencia_externa = ${q(id)} AND tipo = ${q(tipo)}::tipo_cargo);`);
    if (anulado) {
      const motivoNota = devuelta
        ? `Reserva ${id}: garantía devuelta, finalizada sin daños (R6)`
        : `Reserva ${id}: se anulan sus cargos (R7)`;
      sqlCargos.push(`
INSERT INTO nota_credito (cargo_id, monto, motivo, referencia_externa, creada_por)
SELECT ${q(cargoId)}, ${monto}, ${q(motivoNota)}, ${q(`${id}:${tipo}`)}, ${q(devuelta ? ADMIN_SUB : 'saga-reservas')}
WHERE EXISTS (SELECT 1 FROM cargo WHERE id = ${q(cargoId)}) ON CONFLICT (referencia_externa) DO NOTHING;`);
    }
  }
}

console.log(`3) Reservas: ${RESERVAS.length} con su saga completada…`);
enReservas('reservas', `BEGIN;${sqlReservas.join('\n')}\nCOMMIT;`);
console.log('4) Gestión: cargos y notas de crédito de esas reservas…');
enGestion('gestion', `BEGIN;${sqlCargos.join('\n')}\nCOMMIT;`);

console.log('\nResumen');
console.log(enGestion('gestion', `
select 'unidades morosas' k, count(*)::text v from v_morosos
union all select 'morosas bloqueadas para reservar (R4)', count(*)::text from v_morosos where bloqueado_para_reservar
union all select 'deuda vencida total', coalesce(sum(deuda_vencida),0)::text from v_estado_cuenta
union all select 'pagos pendientes de conciliar', count(*)::text from pago where estado = 'PENDIENTE'
union all select 'recargos propuestos', count(*)::text from recargo_propuesto where estado = 'PROPUESTO'
union all select 'cargos de reservas', count(*)::text from cargo where tipo in ('USO_AREA','GARANTIA');`, '-At -F " : "'));
console.log(enReservas('reservas', "select 'reservas ' || estado::text, count(*)::text from reserva group by estado order by 1;", '-At -F " : "'));
