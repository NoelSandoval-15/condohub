#!/usr/bin/env node
// Prueba de caos de la saga de reserva (S2, S3) en el sistema LOCAL: apaga a Acceso a mitad de la saga y comprueba la compensación.
//   Uso:  node infra/probar-caos-saga.mjs               (Acceso NO vuelve: se agota el plazo y la saga compensa)
//         node infra/probar-caos-saga.mjs --recuperar   (Acceso vuelve a los 10 s, dentro del plazo: la saga continúa sola)
//   Con el compose levantado; usa GATEWAY_PORT y la contraseña de infra/.env.
// Qué hace: 1) apaga el consumidor de Acceso (paso 3, pases QR); 2) como residente, reserva el salón con invitados;
//   3) espera a que Reservas agote los reintentos y compense; 4) muestra la evidencia (reserva, saga, pasos y cargos) y
//   5) vuelve a encender lo que apagó, pase lo que pase. Esperado sin --recuperar: reserva FALLIDA, saga COMPENSADA y cargos
//   ANULADOS. Con --recuperar: reserva CONFIRMADA y cargos vigentes (el comando esperó en la cola durable, S2).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

function leerEnv() {
  const ruta = join(aqui, '.env');
  const valores = {};
  if (!existsSync(ruta)) return valores;
  for (const l of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
    if (m) valores[m[1]] = m[2].replace(/\s+#.*$/, '');
  }
  return valores;
}

const env = leerEnv();
const API = process.env.GATEWAY_URL ?? `http://localhost:${env.GATEWAY_PORT || 8080}`;
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8180/realms/condohub/protocol/openid-connect/token';
const CLAVE = process.env.USUARIOS_PRUEBA_PASSWORD ?? env.USUARIOS_PRUEBA_PASSWORD ?? 'Condohub123!';
const CONSUMIDOR_ACCESO = process.env.CONSUMIDOR_ACCESO ?? 'condohub-acceso-saga-1';
const POSTGRES = process.env.POSTGRES_CONTENEDOR ?? 'condohub-postgres-1';
const ESPERA_MAXIMA_S = 420;
const RECUPERAR = process.argv.includes('--recuperar');
const REENCENDER_A_LOS_S = 10;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const sql = (bd, consulta) => docker('exec', POSTGRES, 'psql', '-U', 'postgres', '-d', bd, '-At', '-F', ' | ', '-c', consulta).stdout.trim();

async function pedir(ruta, { token, cuerpo, clave } = {}) {
  const r = await fetch(`${API}${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...(clave && { 'idempotency-key': clave }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: r.status, cuerpo: await r.json().catch(() => null) };
}

async function login() {
  const r = await fetch(KEYCLOAK, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'condohub-spa', username: 'residente@condohub.test', password: CLAVE }),
  });
  if (!r.ok) throw new Error(`login rechazado (HTTP ${r.status}); revisa USUARIOS_PRUEBA_PASSWORD`);
  return (await r.json()).access_token;
}

async function crearReserva(token, unidadId, area) {
  for (let intento = 0; intento < 8; intento++) {
    const dia = new Date(Date.now() + (20 + Math.floor(Math.random() * 35)) * 86400000).toISOString().slice(0, 10);
    const reserva = { areaId: area.id, unidadId, inicio: `${dia}T14:00:00Z`, fin: `${dia}T18:00:00Z`, invitados: [{ nombre: 'Invitado Uno' }, { nombre: 'Invitado Dos' }] };
    const r = await pedir('/reservas/api/reservas', { token, cuerpo: reserva, clave: crypto.randomUUID() });
    if (r.estado < 300) return r.cuerpo;
    if (r.cuerpo?.code !== 'R2') throw new Error(`no se pudo reservar: HTTP ${r.estado} ${JSON.stringify(r.cuerpo)}`);
  }
  throw new Error('no se encontró un horario libre para la prueba');
}

async function main() {
  const token = await login();
  const perfil = await pedir('/gestion/graphql', { token, cuerpo: { query: '{ miPerfil { unidades { unidadId codigo } } }' } });
  const unidad = perfil.cuerpo.data.miPerfil.unidades[0];
  const areas = await pedir('/reservas/api/areas', { token });
  const salon = (areas.cuerpo.data ?? areas.cuerpo).find((a) => /sal/i.test(a.nombre));
  console.log(`Unidad ${unidad.codigo}, área «${salon.nombre}»`);

  console.log(`\n1) Apagando a Acceso (${CONSUMIDOR_ACCESO}) para simular su caída…`);
  docker('stop', CONSUMIDOR_ACCESO);

  console.log('2) Reservando el salón con 2 invitados (necesita pases de Acceso)…');
  const reserva = await crearReserva(token, unidad.unidadId, salon);
  console.log(`   reserva ${reserva.id.slice(0, 8)} creada en estado ${reserva.estado}`);

  console.log(RECUPERAR ? `3) Acceso vuelve a los ${REENCENDER_A_LOS_S} s, antes de que venza el plazo…` : '3) Esperando a que venza el plazo del paso y Reservas compense…');
  const inicio = Date.now();
  let estado = reserva.estado;
  let reencendido = !RECUPERAR;
  while ((Date.now() - inicio) / 1000 < ESPERA_MAXIMA_S && !['FALLIDA', 'CONFIRMADA', 'CANCELADA'].includes(estado)) {
    await dormir(3000);
    if (!reencendido && (Date.now() - inicio) / 1000 >= REENCENDER_A_LOS_S) {
      docker('start', CONSUMIDOR_ACCESO);
      reencendido = true;
      console.log(`   +${Math.round((Date.now() - inicio) / 1000)} s → Acceso vuelve a estar disponible`);
    }
    const todas = await pedir('/reservas/api/reservas', { token });
    const actual = (todas.cuerpo.data ?? todas.cuerpo).find((x) => x.id === reserva.id);
    if (actual && actual.estado !== estado) console.log(`   +${Math.round((Date.now() - inicio) / 1000)} s → ${actual.estado}`);
    estado = actual?.estado ?? estado;
  }

  console.log('\n4) Evidencia');
  console.log('   saga      :', sql('reservas', `select estado, 'paso '||paso_actual, coalesce(ultimo_error,'-') from saga_instancia where reserva_id='${reserva.id}'`));
  console.log('   pasos     :');
  sql('reservas', `select numero||' '||nombre, estado, 'intentos '||intentos, 'compensación '||intentos_compensacion from saga_paso where saga_id=(select id from saga_instancia where reserva_id='${reserva.id}') order by numero`)
    .split('\n').forEach((l) => console.log('     ', l));
  const cargos = sql('gestion', `select tipo, estado, 'saldo '||saldo from cargo where referencia_externa like '%${reserva.id}%'`);
  console.log('   cargos    :', cargos.replace(/\n/g, ' ; ') || '(ninguno registrado)');
  const anulados = cargos !== '' && cargos.split('\n').every((l) => l.includes('ANULADO'));

  const vigentes = cargos !== '' && !cargos.includes('ANULADO');
  const ok = RECUPERAR ? estado === 'CONFIRMADA' && vigentes : estado === 'FALLIDA' && anulados;
  const bien = RECUPERAR ? '✓ La saga se recuperó sola' : '✓ Compensación correcta';
  const mal = RECUPERAR ? '✗ La saga no terminó como se esperaba' : '✗ La compensación no fue la esperada';
  console.log(`
${ok ? bien : mal}: reserva ${estado}, cargos ${vigentes ? 'vigentes' : anulados ? 'anulados' : 'sin definir'}.`);
  return ok ? 0 : 1;
}

let codigo = 1;
try {
  codigo = await main();
} catch (e) {
  console.error('✗', e.message);
} finally {
  console.log(`\n5) Encendiendo de nuevo a Acceso (${CONSUMIDOR_ACCESO})…`);
  docker('start', CONSUMIDOR_ACCESO);
}
process.exit(codigo);
