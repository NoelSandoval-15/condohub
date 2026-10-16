// Prueba del camino de fallo: con el SMTP apagado, el aviso no se pierde ni reencola sin freno:
// el flujo lo desvía a la cola de revisión manual (condohub.dlq), y al volver el SMTP un reenvío manual sí se entrega.
// Uso (con el compose arriba y los flujos cargados):  node infra/n8n/probar-fallo.mjs
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const compose = join(aqui, '..', 'docker-compose.yml');
const RABBIT = process.env.RABBITMQ_API ?? 'http://localhost:15672';
const MAILPIT = process.env.MAILPIT_API ?? 'http://localhost:8025';
const autorizacion = 'Basic ' + Buffer.from(`${process.env.RABBITMQ_USER ?? 'condohub'}:${process.env.RABBITMQ_PASSWORD ?? 'condohub'}`).toString('base64');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const dc = (...a) => spawnSync('docker', ['compose', '-f', compose, ...a], { encoding: 'utf8' });
const api = (ruta, opciones = {}) => fetch(`${RABBIT}/api${ruta}`, { ...opciones, headers: { Authorization: autorizacion, 'Content-Type': 'application/json' } });

async function publicar(evento) {
  const r = await api('/exchanges/%2F/condohub.events/publish', {
    method: 'POST',
    body: JSON.stringify({ properties: { delivery_mode: 2, content_type: 'application/json', message_id: evento.eventId }, routing_key: evento.type, payload: JSON.stringify(evento), payload_encoding: 'string' }),
  });
  if (!(await r.json()).routed) throw new Error('El evento no se enrutó');
}
const mensajesEn = async (cola) => (await (await api(`/queues/%2F/${cola}`)).json()).messages ?? 0;

const evento = { ...JSON.parse(readFileSync(join(aqui, 'eventos-de-ejemplo.json'), 'utf8'))[0], eventId: randomUUID() };
let fallos = 0;
const verificar = (ok, texto) => {
  console.log(`${ok ? '✓' : '✗'} ${texto}`);
  if (!ok) fallos++;
};

try {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
  dc('stop', 'mailpit');                                                     // el SMTP se cae
  await publicar(evento);
  // Con el SMTP caído, la conexión puede tardar su tiempo de espera interno (hasta ~2 min) antes de fallar: se espera.
  const buscar = async () => {
    const lectura = await (await api('/queues/%2F/condohub.dlq/get', { method: 'POST', body: JSON.stringify({ count: 100, ackmode: 'ack_requeue_true', encoding: 'auto' }) })).json();
    return lectura.map((m) => JSON.parse(m.payload)).find((m) => m.evento?.eventId === evento.eventId);
  };
  let guardado = await buscar();
  for (let i = 0; i < 150 && !guardado; i++) {
    await dormir(1000);
    guardado = await buscar();
  }
  verificar(Boolean(guardado), 'el aviso fallido llegó a condohub.dlq con el evento original');
  console.log('   motivo:', guardado?.motivo);

  // El flujo confirma el mensaje al terminar su ejecución: la cola de entrada debe quedar vacía y sin reentregas.
  let pendientes = await mensajesEn('n8n.eventos');
  for (let i = 0; i < 30 && pendientes !== 0; i++) {
    await dormir(1000);
    pendientes = await mensajesEn('n8n.eventos');
  }
  const estadistica = (await (await api('/queues/%2F/n8n.eventos')).json()).message_stats ?? {};
  verificar(pendientes === 0 && !(estadistica.redeliver > 0), 'n8n.eventos quedó vacía y sin reentregas: no hay reencolado sin freno');
} finally {
  dc('start', 'mailpit');
}
await dormir(4000);
await publicar({ ...evento });                                               // reenvío manual: el mismo evento, ya con el SMTP de vuelta
let llegado = false;
for (let i = 0; i < 20 && !llegado; i++) {
  await dormir(1000);
  const lista = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
  llegado = (lista.messages ?? []).some((m) => /Visitante recurrente/.test(m.Subject));
}
verificar(llegado, 'con el SMTP de vuelta, reenviar el mismo evento sí entrega el correo (no quedó marcado como procesado)');
process.exit(fallos ? 1 : 0);
