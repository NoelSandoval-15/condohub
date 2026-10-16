// Crea (o reutiliza) una cuenta en el realm condohub con su rol y, si se indica --persona, la enlaza en Gestión.
// Uso (desde la raíz de condohub, con Keycloak arriba; para enlazar también Gestión y el gateway):
//   node infra/keycloak/crear-cuenta.mjs --email ana@vecinos.condohub.test --rol RESIDENTE --nombre "Ana Pérez" --persona <personaId>
//   --password <clave>   opcional; por defecto USUARIOS_PRUEBA_PASSWORD (Condohub123!)
//   --persona <uuid>     opcional; id de la persona en Gestión (lo da `miPerfil` o la consola del ADMIN)
// Variables opcionales: KEYCLOAK_URL (http://localhost:8180), KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD (admin/admin),
//   GATEWAY_PORT (8080), USUARIOS_PRUEBA_PASSWORD. Es idempotente: repetirlo no duplica la cuenta ni el enlace.
// Solo desarrollo: el usuario de Gestión que enlaza es admin@condohub.test.

const keycloak = process.env.KEYCLOAK_URL ?? 'http://localhost:8180';
const gateway = `http://localhost:${process.env.GATEWAY_PORT ?? 8080}`;
const realm = 'condohub';
const ROLES = ['ADMIN', 'RESIDENTE', 'GUARDIA'];

function argumentos() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 2) a[v[i].replace(/^--/, '')] = v[i + 1];
  return a;
}

async function json(url, opciones = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), ...opciones });
  const texto = await r.text();
  if (!r.ok && !opciones.tolerar?.includes(r.status)) throw new Error(`${opciones.method ?? 'GET'} ${url} -> ${r.status} ${texto}`);
  return { status: r.status, cuerpo: texto ? JSON.parse(texto) : null, cabeceras: r.headers };
}

async function tokenAdminKeycloak() {
  const cuerpo = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: process.env.KEYCLOAK_ADMIN ?? 'admin',
    password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin',
  });
  return (await json(`${keycloak}/realms/master/protocol/openid-connect/token`, { method: 'POST', body: cuerpo })).cuerpo.access_token;
}

async function main() {
  const { email, rol, nombre, persona, password } = argumentos();
  if (!email || !ROLES.includes(rol)) {
    console.error(`Falta --email o --rol (${ROLES.join(' | ')}). Mira el encabezado del archivo.`);
    process.exit(1);
  }
  const clave = password ?? process.env.USUARIOS_PRUEBA_PASSWORD ?? 'Condohub123!';
  const admin = { authorization: `Bearer ${await tokenAdminKeycloak()}`, 'content-type': 'application/json' };
  const base = `${keycloak}/admin/realms/${realm}`;

  // 1. Usuario: se busca por email exacto y solo se crea si no existe.
  let existentes = (await json(`${base}/users?email=${encodeURIComponent(email)}&exact=true`, { headers: admin })).cuerpo;
  if (existentes.length === 0) {
    const [nombrePila, ...resto] = (nombre ?? email.split('@')[0]).split(' ');
    await json(`${base}/users`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({
        username: email,
        email,
        emailVerified: true,
        enabled: true,
        firstName: nombrePila,
        lastName: resto.join(' ') || '-',
        credentials: [{ type: 'password', value: clave, temporary: false }],
      }),
    });
    existentes = (await json(`${base}/users?email=${encodeURIComponent(email)}&exact=true`, { headers: admin })).cuerpo;
    console.log(`Cuenta creada: ${email}`);
  } else {
    console.log(`La cuenta ya existía: ${email}`);
  }
  const sub = existentes[0].id;

  // 2. Rol del realm (si ya lo tiene, Keycloak no lo duplica).
  const rolRealm = (await json(`${base}/roles/${rol}`, { headers: admin })).cuerpo;
  await json(`${base}/users/${sub}/role-mappings/realm`, { method: 'POST', headers: admin, body: JSON.stringify([rolRealm]) });
  console.log(`Rol ${rol} asignado. sub = ${sub}`);

  // 3. Enlace con la persona de Gestión (mutation enlazarCuenta, solo ADMIN).
  if (persona) {
    const login = new URLSearchParams({
      grant_type: 'password',
      client_id: 'condohub-spa',
      username: 'admin@condohub.test',
      password: process.env.USUARIOS_PRUEBA_PASSWORD ?? 'Condohub123!',
    });
    const tokenAdmin = (await json(`${keycloak}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', body: login })).cuerpo.access_token;
    const consulta = `mutation { enlazarCuenta(personaId: "${persona}", keycloakSub: "${sub}") { nombre keycloakSub } }`;
    const r = await json(`${gateway}/gestion/graphql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenAdmin}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: consulta }),
    });
    if (r.cuerpo.errors) {
      console.error(`No se pudo enlazar: ${JSON.stringify(r.cuerpo.errors[0].extensions?.code)} ${r.cuerpo.errors[0].message}`);
      process.exit(1);
    }
    console.log(`Enlazada con la persona ${r.cuerpo.data.enlazarCuenta.nombre}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
