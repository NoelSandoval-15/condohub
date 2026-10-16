// Prueba de punta a punta del flujo «Eventos de CondoHub»: publica eventos de ejemplo en el exchange condohub.events
// y comprueba los correos que llegan al buzón de pruebas (Mailpit).
// Uso (con el compose arriba y los flujos cargados con importar.mjs):  node infra/n8n/probar.mjs
// Variables opcionales: RABBITMQ_API (http://localhost:15672), RABBITMQ_USER/RABBITMQ_PASSWORD (condohub/condohub),
// MAILPIT_API (http://localhost:8025), GUARDIA_EMAIL y ADMIN_EMAIL (los mismos que usa el contenedor de n8n),
// CONTACTOS_UNIDADES (el mismo JSON que usa n8n, para saber a quién debe llegar cada aviso).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RABBIT = process.env.RABBITMQ_API ?? 'http://localhost:15672';
const MAILPIT = process.env.MAILPIT_API ?? 'http://localhost:8025';
const autorizacion = 'Basic ' + Buffer.from(`${process.env.RABBITMQ_USER ?? 'condohub'}:${process.env.RABBITMQ_PASSWORD ?? 'condohub'}`).toString('base64');
const GUARDIA = process.env.GUARDIA_EMAIL ?? 'guardia@condohub.test';
const ADMIN = process.env.ADMIN_EMAIL ?? 'admin@condohub.test';
let contactos = {};
try {
  contactos = JSON.parse(process.env.CONTACTOS_UNIDADES || '{}');
} catch {
  contactos = {};
}
const deResidente = (unidadId) => contactos[unidadId] ?? ADMIN;

async function publicar(evento) {
  const r = await fetch(`${RABBIT}/api/exchanges/%2F/condohub.events/publish`, {
    method: 'POST',
    headers: { Authorization: autorizacion, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { delivery_mode: 2, content_type: 'application/json', message_id: evento.eventId },
      routing_key: evento.type,
      payload: JSON.stringify(evento),
      payload_encoding: 'string',
    }),
  });
  const cuerpo = await r.json();
  if (!r.ok || !cuerpo.routed) throw new Error(`No se pudo publicar ${evento.type}: ${JSON.stringify(cuerpo)}`);
}

async function correos() {
  const r = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
  if (!r.ok) throw new Error(`Mailpit respondió ${r.status}`);
  return (await r.json()).messages ?? [];
}

async function esperarCorreos(cantidad, ms = 30000) {
  const limite = Date.now() + ms;
  let actuales = await correos();
  while (actuales.length < cantidad && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 1000));
    actuales = await correos();
  }
  return actuales;
}

const ejemplos = JSON.parse(readFileSync(join(aqui, 'eventos-de-ejemplo.json'), 'utf8'));
const eventos = ejemplos.map((e) => ({ ...e, eventId: randomUUID() }));   // ids nuevos en cada corrida: si no, se verían como repetidos

await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
for (const e of eventos) await publicar(e);
await publicar(eventos[0]);                                                  // el MISMO evento otra vez: no debe generar otro correo

const esperados = [
  { tipo: 'visitante recurrente', para: GUARDIA, asunto: /Visitante recurrente/ },
  { tipo: 'pago por conciliar', para: ADMIN, asunto: /Pago pendiente/ },
  { tipo: 'recibo', para: deResidente(eventos[2].data.unidadId), asunto: /Recibo N° 000123/ },
  { tipo: 'reserva confirmada', para: deResidente(eventos[3].data.unidadId), asunto: /Reserva confirmada/ },
  { tipo: 'reserva fallida', para: deResidente(eventos[4].data.unidadId), asunto: /No se pudo completar/ },
];

let recibidos = await esperarCorreos(esperados.length);
await new Promise((r) => setTimeout(r, 4000));                               // margen para detectar un correo de más (el repetido)
recibidos = await correos();

let fallos = 0;
for (const esperado of esperados) {
  const hallado = recibidos.find((m) => esperado.asunto.test(m.Subject));
  const para = hallado?.To?.map((t) => t.Address).join(', ');
  const bien = hallado && para === esperado.para;
  console.log(`${bien ? '✓' : '✗'} ${esperado.tipo.padEnd(22)} -> ${para ?? '(no llegó)'}${bien ? '' : `   (esperado: ${esperado.para})`}`);
  if (!bien) fallos++;
}
const repetido = recibidos.length === esperados.length;
console.log(`${repetido ? '✓' : '✗'} el evento repetido no generó otro correo (${recibidos.length} correos, ${esperados.length} esperados)`);
if (!repetido) fallos++;
process.exit(fallos ? 1 : 0);
