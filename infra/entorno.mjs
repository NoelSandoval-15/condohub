#!/usr/bin/env node
// Cambia los frontends entre LOCAL y PRODUCCIÓN (Azure) desde un solo lugar: infra/.env.
//   1. En infra/.env deja activa UNA línea: ENTORNO=local  o  ENTORNO=produccion (la otra, comentada con #).
//   2. Corre:  node infra/entorno.mjs        (o con el entorno explícito: node infra/entorno.mjs produccion)
//   3. Reinicia `npm run dev` o vuelve a compilar los frontends: Vite lee el .env al arrancar.
// Reescribe frontends/{shell,admin,residente,guardia}/.env (ignorados por git). No toca secretos ni el móvil: del móvil
// solo imprime los --dart-define que corresponden.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function leerEnv(ruta) {
  const valores = {};
  if (!existsSync(ruta)) return valores;
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linea);
    if (m) valores[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  }
  return valores;
}

function salir(mensaje) {
  console.error(`Error: ${mensaje}`);
  process.exit(1);
}

const env = leerEnv(join(raiz, 'infra', '.env'));
const entorno = (process.argv[2] ?? env.ENTORNO ?? 'local').toLowerCase();
if (!['local', 'produccion'].includes(entorno)) salir(`ENTORNO debe ser "local" o "produccion" (llegó "${entorno}")`);
const dominio = env.DOMINIO_PRODUCCION ?? '';
if (entorno === 'produccion' && !dominio) salir('falta DOMINIO_PRODUCCION en infra/.env (ej. 68-211-120-83.sslip.io)');

const local = {
  gateway: `http://localhost:${env.GATEWAY_PORT || '8080'}`,
  issuer: 'http://localhost:8180/realms/condohub',
  admin: 'http://localhost:4200/remoteEntry.js',
  residente: 'http://localhost:5174/assets/remoteEntry.js',
  guardia: 'http://localhost:5175/assets/remoteEntry.js',
};
const produccion = {
  gateway: `https://api.${dominio}`,
  issuer: `https://auth.${dominio}/realms/condohub`,
  admin: `https://admin.${dominio}/remoteEntry.js`,
  residente: `https://residente.${dominio}/assets/remoteEntry.js`,
  guardia: `https://guardia.${dominio}/assets/remoteEntry.js`,
};

/** Escribe las dos variantes; la del entorno elegido va activa y la otra comentada (también se puede cambiar a mano). */
function bloques(formato) {
  const activa = entorno === 'local' ? local : produccion;
  const inactiva = entorno === 'local' ? produccion : local;
  const nombreActiva = entorno === 'local' ? 'LOCAL' : 'PRODUCCIÓN (Azure)';
  const nombreInactiva = entorno === 'local' ? 'PRODUCCIÓN (Azure)' : 'LOCAL';
  const activas = formato(activa);
  const inactivas = formato(inactiva).map((l) => `# ${l}`);
  return `# --- ${nombreActiva} (activo) ---\n${activas.join('\n')}\n\n# --- ${nombreInactiva} ---\n${inactivas.join('\n')}\n`;
}

const CABECERA = `# Generado por infra/entorno.mjs (ENTORNO=${entorno}). Para cambiar de entorno edita infra/.env y vuelve a correrlo.\n\n`;
const archivos = {
  shell: (v) => [`VITE_KEYCLOAK_ISSUER=${v.issuer}`, `VITE_REMOTE_ADMIN=${v.admin}`, `VITE_REMOTE_RESIDENTE=${v.residente}`, `VITE_REMOTE_GUARDIA=${v.guardia}`],
  admin: (v) => [`VITE_GATEWAY_URL=${v.gateway}`],
  residente: (v) => [`VITE_GATEWAY_URL=${v.gateway}`],
  guardia: (v) => [`VITE_GATEWAY_URL=${v.gateway}`],
};

for (const [frontend, formato] of Object.entries(archivos)) {
  const carpeta = join(raiz, 'frontends', frontend);
  if (!existsSync(carpeta)) {
    console.log(`  (omitido) ${frontend}: no existe la carpeta`);
    continue;
  }
  writeFileSync(join(carpeta, '.env'), CABECERA + bloques(formato));
  console.log(`  frontends/${frontend}/.env  →  ${entorno}`);
}

const activo = entorno === 'local' ? local : produccion;
console.log(`\nEntorno de los frontends: ${entorno.toUpperCase()}`);
console.log('Reinicia `npm run dev` o vuelve a compilar para que Vite lo tome.');
console.log('\nApp móvil (se elige al compilar, no usa .env):');
if (entorno === 'local') {
  console.log('  flutter build apk --profile --target-platform android-arm64   (con adb reverse de 8180 y 8090)');
} else {
  console.log('  flutter build apk --release --target-platform android-arm64 \\');
  console.log(`    --dart-define=GATEWAY_URL=${activo.gateway} --dart-define=KEYCLOAK_ISSUER=${activo.issuer} --dart-define=PERMITIR_HTTP=false`);
}
