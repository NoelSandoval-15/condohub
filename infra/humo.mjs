// Prueba de humo: ¿puedo loguearme y llegar a cada microservicio por el gateway?
// Uso (desde la raíz de condohub, con la infra arriba y los servicios que quieras probar):
//   node infra/humo.mjs
// Variables opcionales: GATEWAY_PORT (8080), KEYCLOAK_URL (http://localhost:8180), USUARIOS_PRUEBA_PASSWORD (Condohub123!)
// Sale con código 1 si algún servicio que SÍ está levantado responde algo inesperado.

const gateway = `http://localhost:${process.env.GATEWAY_PORT ?? 8080}`;
const keycloak = process.env.KEYCLOAK_URL ?? 'http://localhost:8180';
const clave = process.env.USUARIOS_PRUEBA_PASSWORD ?? 'Condohub123!';
const usuarios = ['admin', 'residente', 'guardia'];

// Un "hola" por servicio. El de Gestión es GraphQL; los demás son REST.
const servicios = [
  { nombre: 'gestion', puerto: 8081, llamar: (t) => peticion(`${gateway}/gestion/graphql`, t, { method: 'POST', body: '{"query":"{ salud { estado } }"}' }) },
  { nombre: 'reservas', puerto: 8082, llamar: (t) => peticion(`${gateway}/reservas/api/salud`, t) },
  { nombre: 'acceso', puerto: 3001, llamar: (t) => peticion(`${gateway}/acceso/api/salud`, t) },
  { nombre: 'ia', puerto: 8083, llamar: (t) => peticion(`${gateway}/ia/salud`, t) },
  { nombre: 'agentes', puerto: 8084, llamar: (t) => peticion(`${gateway}/agentes/salud`, t) },
];

async function peticion(url, token, extra = {}) {
  const cabeceras = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  try {
    const r = await fetch(url, { ...extra, headers: cabeceras, signal: AbortSignal.timeout(8000) });
    return r.status;
  } catch {
    return 'sin gateway';
  }
}

async function token(usuario) {
  const cuerpo = new URLSearchParams({ grant_type: 'password', client_id: 'condohub-spa', username: `${usuario}@condohub.test`, password: clave });
  try {
    const r = await fetch(`${keycloak}/realms/condohub/protocol/openid-connect/token`, { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return (await r.json()).access_token;
  } catch {
    return null;
  }
}

function rolesDe(accessToken) {
  const carga = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
  return carga.realm_access?.roles?.filter((r) => ['ADMIN', 'RESIDENTE', 'GUARDIA'].includes(r)) ?? [];
}

console.log(`Gateway: ${gateway}   Keycloak: ${keycloak}\n`);

// 1) Login de los tres usuarios
const tokens = {};
let fallos = 0;
for (const u of usuarios) {
  tokens[u] = await token(u);
  if (tokens[u]) {
    console.log(`  login ${u.padEnd(10)} OK   roles: ${rolesDe(tokens[u]).join(', ') || '(ninguno)'}`);
  } else {
    console.log(`  login ${u.padEnd(10)} FALLA (¿Keycloak arriba? ¿contraseña correcta?)`);
    fallos++;
  }
}
if (fallos) {
  console.log('\nSin token no se puede seguir. Levanta Keycloak: docker compose -f infra/docker-compose.yml up -d keycloak gateway');
  process.exit(1);
}

// 2) Cada servicio, sin token y con el token de cada rol
console.log('\nservicio     sin token   admin  residente  guardia   resultado');
let caidos = 0;
for (const s of servicios) {
  const sin = await s.llamar(null);
  const filas = [];
  for (const u of usuarios) filas.push(await s.llamar(tokens[u]));
  let resultado;
  // Kong rechaza con 401 sin token aunque el servicio no exista; solo con token se nota si está caído (502/503).
  if (filas.every((c) => c === 502 || c === 503 || c === 'sin gateway')) {
    resultado = `no levantado (puerto ${s.puerto})`;
    caidos++;
  } else if (sin === 401 && filas.every((c) => c === 200)) {
    resultado = 'OK';
  } else {
    resultado = 'INESPERADO (se esperaba 401 sin token y 200 con token)';
    fallos++;
  }
  console.log(`${s.nombre.padEnd(12)} ${String(sin).padEnd(11)} ${String(filas[0]).padEnd(6)} ${String(filas[1]).padEnd(10)} ${String(filas[2]).padEnd(9)} ${resultado}`);
}

console.log(`\n${fallos ? 'HAY FALLOS' : 'Sin fallos'}${caidos ? `; ${caidos} servicio(s) sin levantar (normal si aún no los arrancaste)` : ''}.`);
process.exit(fallos ? 1 : 0);
