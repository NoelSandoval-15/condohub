#!/usr/bin/env bash
# Despliega la parte de Google Cloud (Reservas, Servicio IA con Mongo y almacén S3, y Agentes, detrás de Caddy) en esta VM.
# Necesita infra/.env completo (gcp.env.example) y los repos de ia y agentes clonados en ~/condohub/services.
# Se puede repetir: reconstruye lo que cambió.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$INFRA"
[ -f .env ] || { echo "Falta infra/.env: copia nube/gcp/gcp.env.example y complétalo" >&2; exit 1; }
set -a
. ./.env
set +a
for v in DOMINIO AZURE_DOMINIO RABBITMQ_HOST POSTGRES_PASSWORD RESERVAS_APP_KEY S3_ACCESS_KEY S3_SECRET_KEY; do
  [ -n "${!v:-}" ] || { echo "Falta $v en infra/.env" >&2; exit 1; }
done
for r in reservas ia agentes; do
  [ -d "../services/$r" ] || { echo "Falta el repo ../services/$r (git clone https://github.com/luisrepo25/condohub-$r.git)" >&2; exit 1; }
done
for f in yolov8n_placas_int8.onnx cct_xs_v2_global.onnx; do
  [ -f "../services/ia/modelos/$f" ] || echo "Aviso: falta ../services/ia/modelos/$f (el lector de placas responderá 'no disponible'; los .onnx no van a git)" >&2
done

# Credenciales del almacén S3: las de esta VM (no las de desarrollo del repo), solo para el servicio IA.
mkdir -p nube/gcp/generado
cat > nube/gcp/generado/s3.json <<EOF
{
  "identities": [
    {
      "name": "condohub",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY}", "secretKey": "${S3_SECRET_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
EOF
chmod 600 nube/gcp/generado/s3.json

cd nube/gcp
docker compose --env-file ../../.env -f docker-compose.gcp.yml up -d --build
# Caddy lee su archivo solo al arrancar: se reinicia para tomar los nombres nuevos (los certificados quedan en su volumen).
docker compose --env-file ../../.env -f docker-compose.gcp.yml restart caddy

echo
echo "Listo. Comprueba (sin token responden 401, que significa que están vivos):"
echo "  https://reservas.${DOMINIO}/api/salud"
echo "  https://ia.${DOMINIO}/salud"
echo "  https://agentes.${DOMINIO}/salud"
