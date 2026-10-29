// Publica UN evento de ejemplo en el exchange condohub.events para disparar el flujo «Eventos de CondoHub» en una demostración.
// Uso:  node infra/n8n/publicar-evento.mjs [tipo]      (por omisión, VisitanteRecurrenteDetectado)
//       node infra/n8n/publicar-evento.mjs PagoRegistrado
// Cada ejecución usa un `eventId` nuevo (S5: un consumidor idempotente descartaría uno repetido). Tipos disponibles:
// los de infra/n8n/eventos-de-ejemplo.json. Variables opcionales: RABBITMQ_API (http://localhost:15672), RABBITMQ_USER y
// RABBITMQ_PASSWORD (condohub/condohub).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const RABBIT = process.env.RABBITMQ_API ?? 'http://localhost:15672';
const autorizacion = 'Basic ' + Buffer.from(`${process.env.RABBITMQ_USER ?? 'condohub'}:${process.env.RABBITMQ_PASSWORD ?? 'condohub'}`).toString('base64');

const buscado = process.argv[2] ?? 'VisitanteRecurrenteDetectado';
const ejemplos = JSON.parse(readFileSync(join(aqui, 'eventos-de-ejemplo.json'), 'utf8'));
const lista = Array.isArray(ejemplos) ? ejemplos : Object.values(ejemplos);
const base = lista.find((e) => e.type.endsWith(buscado) || e.type === buscado);
if (!base) {
  console.error(`No hay un evento de ejemplo «${buscado}». Disponibles: ${[...new Set(lista.map((e) => e.type))].join(', ')}`);
  process.exit(1);
}

const evento = { ...base, eventId: randomUUID(), occurredAt: new Date().toISOString() };
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
const cuerpo = await r.json().catch(() => ({}));
if (!r.ok || !cuerpo.routed) {
  console.error(`No se pudo publicar ${evento.type}: ${JSON.stringify(cuerpo)}`);
  process.exit(1);
}
console.log(`Publicado ${evento.type} (eventId ${evento.eventId}). Míralo en n8n → Executions, en el correo y en el push.`);
