// Publica en el almacén S3 local los modelos de placas que están en services/ia/modelos (los 2 .onnx del Drive del equipo).
// Uso (desde la raíz, con la plataforma levantada con docker-compose.apps.yml):  node infra/publicar-modelos.mjs
// Es idempotente: se puede repetir. Después, GET /ia/modelos/placas/actual y /ia/modelos/lectura-placas/actual dan 200.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const modelos = join(raiz, 'services', 'ia', 'modelos');
const requeridos = ['yolov8n_placas_int8.onnx', 'reconocedor_placas.onnx', 'modelo_placas.json', 'ficha_reconocedor.json'];

const faltan = requeridos.filter((f) => !existsSync(join(modelos, f)));
if (faltan.length) {
  console.error(`✗ Faltan en services/ia/modelos: ${faltan.join(', ')}\n  Copia los .onnx desde el Drive del equipo (las fichas .json vienen en git).`);
  process.exit(1);
}

const compose = ['compose', '-f', join(raiz, 'infra', 'docker-compose.yml'), '-f', join(raiz, 'infra', 'docker-compose.apps.yml')];
function enIa(...cmd) {
  const r = spawnSync('docker', [...compose, 'exec', '-T', 'ia', ...cmd], { encoding: 'utf8', env: process.env });
  if (r.status !== 0) {
    console.error(`✗ ${cmd.slice(2).join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}\n  ¿Está levantado el servicio ia? (docker compose ... up -d ia)`);
    process.exit(1);
  }
  console.log('✓', (r.stdout || '').trim().split('\n').at(-2) ?? '');
}

enIa('python', '-m', 'app.infrastructure.publicar_modelo', '/modelos/modelo_placas.json', '/modelos/yolov8n_placas_int8.onnx');
enIa('python', '-m', 'app.infrastructure.publicar_lectura', '/modelos/ficha_reconocedor.json', '/modelos/reconocedor_placas.onnx');
console.log('Listo. Comprueba con: GET /ia/modelos/placas/actual y /ia/modelos/lectura-placas/actual (token de GUARDIA o ADMIN).');