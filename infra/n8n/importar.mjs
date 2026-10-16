// Carga en n8n las credenciales y los flujos de infra/n8n/flows, y activa los flujos.
// Uso (desde la raíz, con el compose arriba):  node infra/n8n/importar.mjs
// Las credenciales NO viven en el repo: se arman aquí con variables de entorno (valores de desarrollo por defecto)
// y se importan con `n8n import:credentials`, que las cifra con N8N_ENCRYPTION_KEY.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const compose = join(aqui, '..', 'docker-compose.yml');
const N8N = process.env.N8N_URL ?? 'http://localhost:5678';

function dc(...args) {
  return spawnSync('docker', ['compose', '-f', compose, ...args], { encoding: 'utf8' });
}
function exigir(titulo, resultado) {
  if (resultado.status !== 0) {
    console.error(`✗ ${titulo}\n${resultado.stdout ?? ''}${resultado.stderr ?? ''}`);
    process.exit(1);
  }
  console.log(`✓ ${titulo}`);
  return resultado.stdout;
}

const credenciales = [
  {
    id: 'condohub-rabbitmq',
    name: 'CondoHub RabbitMQ',
    type: 'rabbitmq',
    data: {
      hostname: 'rabbitmq',
      port: 5672,
      username: process.env.RABBITMQ_USER ?? 'condohub',
      password: process.env.RABBITMQ_PASSWORD ?? 'condohub',
      vhost: '/',
      ssl: false,
      passwordless: false,
    },
  },
  {
    id: 'condohub-smtp',
    name: 'CondoHub SMTP',
    type: 'smtp',
    // Mailpit (buzón de pruebas del compose): sin usuario, sin TLS. Para un SMTP real, cambiar aquí o en la interfaz de n8n.
    data: { user: '', password: '', host: 'mailpit', port: 1025, secure: false, disableStartTls: true },
  },
];

const enEjecucion = dc('ps', '--status', 'running', '--services');
if (!enEjecucion.stdout.split(/\s+/).includes('n8n')) {
  console.error('✗ El servicio n8n no está corriendo: docker compose -f infra/docker-compose.yml up -d n8n mailpit rabbitmq');
  process.exit(1);
}

const carpeta = mkdtempSync(join(tmpdir(), 'n8n-cred-'));
const archivo = join(carpeta, 'credenciales.json');
try {
  writeFileSync(archivo, JSON.stringify(credenciales));
  exigir('copiar credenciales al contenedor', dc('cp', archivo, 'n8n:/tmp/credenciales.json'));
} finally {
  rmSync(carpeta, { recursive: true, force: true });
}
exigir('importar credenciales', dc('exec', '-T', 'n8n', 'n8n', 'import:credentials', '--input=/tmp/credenciales.json'));
dc('exec', '-T', 'n8n', 'rm', '-f', '/tmp/credenciales.json');
exigir('importar flujos', dc('exec', '-T', 'n8n', 'n8n', 'import:workflow', '--separate', '--input=/flows'));
exigir('activar flujos', dc('exec', '-T', 'n8n', 'n8n', 'update:workflow', '--all', '--active=true'));
exigir('reiniciar n8n para que enganche los disparadores', dc('restart', 'n8n'));

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${N8N}/healthz`)).ok) {
      console.log('✓ n8n listo en', N8N);
      process.exit(0);
    }
  } catch {
    /* todavía arrancando */
  }
  await new Promise((r) => setTimeout(r, 2000));
}
console.error('✗ n8n no respondió a tiempo');
process.exit(1);
