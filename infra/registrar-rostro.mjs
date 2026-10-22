// Registra el perfil facial de una cuenta de prueba con fotos de una o más carpetas (I1, solo desarrollo).
// Uso (desde la raíz, con la plataforma arriba):
//   node infra/registrar-rostro.mjs --carpetas "D:\fotos\Luz alta;D:\fotos\Luz baja" --consentimiento D:\fotos\consentimiento.json
//   --email <cuenta>      cuenta de Keycloak que se registra (por defecto residente@condohub.test)
//   --maximo <n>          fotos por carpeta, repartidas por toda la carpeta (por defecto 20)
//   --lote <n>            fotos por petición (por defecto 8)
// El consentimiento.json trae { "fecha": "AAAA-MM-DD", "version": "..." } (el que firmó la persona; ver docs/negocio/consentimiento-facial.md).
// Variables: KEYCLOAK_URL (http://localhost:8180), GATEWAY_PORT (8080), USUARIOS_PRUEBA_PASSWORD (Condohub123!).
// Las fotos nunca se guardan en el repositorio (I6). Repetirlo AMPLÍA el perfil (TODO(regla) de CLAUDE.md de IA).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const keycloak = process.env.KEYCLOAK_URL ?? 'http://localhost:8180';
const gateway = `http://localhost:${process.env.GATEWAY_PORT ?? 8080}`;
const clave = process.env.USUARIOS_PRUEBA_PASSWORD ?? 'Condohub123!';

const a = Object.fromEntries(process.argv.slice(2).reduce((p, v, i, t) => (i % 2 ? p : [...p, [v.replace(/^--/, ''), t[i + 1]]]), []));
if (!a.carpetas || !a.consentimiento) {
  console.error('Uso: node infra/registrar-rostro.mjs --carpetas "<carpeta1>;<carpeta2>" --consentimiento <consentimiento.json>');
  process.exit(1);
}
const email = a.email ?? 'residente@condohub.test';
const maximo = Number(a.maximo ?? 20);
const lote = Number(a.lote ?? 8);

async function token(usuario) {
  const r = await fetch(`${keycloak}/realms/condohub/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'condohub-spa', username: usuario, password: clave }),
  });
  if (!r.ok) throw new Error(`Login de ${usuario}: ${r.status}`);
  const { access_token: t } = await r.json();
  return { t, sub: JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub };
}

function repartidas(carpeta) {
  const todas = readdirSync(carpeta).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  const paso = Math.max(1, todas.length / maximo);
  return Array.from({ length: Math.min(maximo, todas.length) }, (_, i) => join(carpeta, todas[Math.floor(i * paso)]));
}

const objetivo = await token(email);
const admin = await token('admin@condohub.test');
const perfil = await fetch(`${gateway}/gestion/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${objetivo.t}` },
  body: JSON.stringify({ query: '{ miPerfil { personaId unidades { unidadId } } }' }),
}).then((r) => r.json());
const { personaId, unidades } = perfil.data.miPerfil;
if (!personaId || !unidades.length) throw new Error(`${email} no está enlazada a una persona con unidad en Gestión`);

const consentimiento = JSON.parse(readFileSync(a.consentimiento, 'utf8'));
const fotos = a.carpetas.split(';').flatMap(repartidas);
console.log(`${email} → persona ${personaId}; ${fotos.length} fotos en lotes de ${lote}; consentimiento ${consentimiento.version}`);

let perfilFinal;
for (let i = 0; i < fotos.length; i += lote) {
  const f = new FormData();
  f.append('residenteId', personaId);
  f.append('residenteSub', objetivo.sub);
  f.append('unidadId', unidades[0].unidadId);
  f.append('consentimientoFecha', new Date(`${consentimiento.fecha}T12:00:00Z`).toISOString());
  f.append('consentimientoVersion', consentimiento.version);
  for (const ruta of fotos.slice(i, i + lote)) f.append('fotos', new Blob([readFileSync(ruta)], { type: 'image/jpeg' }), 'foto.jpg');
  const r = await fetch(`${gateway}/ia/rostros/registrar`, { method: 'POST', headers: { authorization: `Bearer ${admin.t}` }, body: f });
  const cuerpo = await r.text();
  if (!r.ok) throw new Error(`Lote ${i / lote + 1}: ${r.status} ${cuerpo}`);
  perfilFinal = JSON.parse(cuerpo);
  console.log(`  lote ${i / lote + 1}: ${perfilFinal.embeddings} embeddings acumulados`);
}
console.log(`Listo. Perfil de ${personaId}: ${perfilFinal.embeddings} embeddings (${perfilFinal.modelo} ${perfilFinal.version}).`);
