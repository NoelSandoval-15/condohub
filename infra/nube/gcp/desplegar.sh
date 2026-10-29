#!/usr/bin/env bash
# Despliega la parte de Google Cloud (Reservas, su outbox, su saga y su Postgres detrás de Caddy) en esta VM.
# Necesita infra/.env completo (gcp.env.example). Se puede repetir: reconstruye lo que cambió.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$INFRA"
[ -f .env ] || { echo "Falta infra/.env: copia nube/gcp/gcp.env.example y complétalo" >&2; exit 1; }
set -a
. ./.env
set +a
for v in DOMINIO AZURE_DOMINIO RABBITMQ_HOST POSTGRES_PASSWORD RESERVAS_APP_KEY; do
  [ -n "${!v:-}" ] || { echo "Falta $v en infra/.env" >&2; exit 1; }
done

cd nube/gcp
docker compose --env-file ../../.env -f docker-compose.gcp.yml up -d --build

echo
echo "Listo. Comprueba: https://reservas.${DOMINIO}/api/salud (sin token responde 401, que significa que está vivo)"
