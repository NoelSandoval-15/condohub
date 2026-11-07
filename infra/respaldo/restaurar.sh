#!/usr/bin/env bash
# Restaura un respaldo de PostgreSQL desde S3 en una base NUEVA (nunca sobre la original), para comprobar que sirve.
#
#   Uso:  restaurar.sh <contenedor-postgres> <clave-del-respaldo> <base-nueva>
#   Ej.:  restaurar.sh condohub-postgres-1 respaldos/azure/2026-11-07/gestion-0200.dump gestion_restaurada
#
# Descarga con curl firmado (mismas variables que respaldar.sh), crea la base nueva y carga el volcado con pg_restore.
# Para MongoDB:  curl firmado -> archivo y  docker exec -i <mongo> mongorestore --archive --gzip --nsFrom 'ia.*' --nsTo 'ia_restaurada.*' < archivo
# Después de comprobar, se borra la base de prueba:  docker exec <contenedor> dropdb -U postgres <base-nueva>
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$AQUI/../.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

[ "$#" -eq 3 ] || { echo "Uso: $0 <contenedor-postgres> <clave-del-respaldo> <base-nueva>" >&2; exit 2; }
CONT="$1"; CLAVE="$2"; NUEVA="$3"
for v in S3_RESPALDO_BUCKET S3_RESPALDO_ACCESS_KEY S3_RESPALDO_SECRET_KEY; do
  [ -n "${!v:-}" ] || { echo "Falta $v en $ENV_FILE" >&2; exit 2; }
done
REGION="${S3_RESPALDO_REGION:-us-east-1}"
ENDPOINT="${S3_RESPALDO_ENDPOINT:-https://s3.${REGION}.amazonaws.com}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Descargando ${CLAVE}..."
curl -sS --fail --max-time 600 --aws-sigv4 "aws:amz:${REGION}:s3" \
  --user "${S3_RESPALDO_ACCESS_KEY}:${S3_RESPALDO_SECRET_KEY}" \
  "${ENDPOINT}/${S3_RESPALDO_BUCKET}/${CLAVE}" -o "$TMP/respaldo.dump"
echo "Descargado: $(wc -c < "$TMP/respaldo.dump" | tr -d ' ') bytes"

docker exec "$CONT" createdb -U postgres "$NUEVA"
docker exec -i "$CONT" pg_restore -U postgres -d "$NUEVA" --no-owner --exit-on-error < "$TMP/respaldo.dump"
echo "Restaurado en la base nueva: ${NUEVA}"
