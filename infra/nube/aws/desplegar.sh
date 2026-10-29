#!/usr/bin/env bash
# Despliega la parte de AWS (Acceso detrás de Caddy) en esta VM. Necesita infra/.env completo (aws.env.example) y el rol
# de IAM con acceso a la tabla de DynamoDB (ver infra/CLAUDE.md). Se puede repetir: reconstruye lo que cambió.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$INFRA"
[ -f .env ] || { echo "Falta infra/.env: copia nube/aws/aws.env.example y complétalo" >&2; exit 1; }
set -a
. ./.env
set +a
for v in DOMINIO AZURE_DOMINIO; do
  [ -n "${!v:-}" ] || { echo "Falta $v en infra/.env" >&2; exit 1; }
done

cd nube/aws
PERFIL=()
[ -n "${RABBITMQ_URL:-}" ] && PERFIL=(--profile saga)
docker compose --env-file ../../.env -f docker-compose.aws.yml "${PERFIL[@]}" up -d --build

echo
echo "Listo. Comprueba: https://acceso.${DOMINIO}/api/salud (sin token responde 401, que significa que está vivo)"
