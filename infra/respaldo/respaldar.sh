#!/usr/bin/env bash
# Respaldo nocturno de las bases de ESTA VM a S3, en la carpeta respaldos/ del bucket de documentos.
#
#   Uso:  respaldar.sh azure|gcp|local          (local = el compose de tu PC, para probarlo)
#
# Qué respalda: azure = gestion y keycloak (PostgreSQL) · gcp = reservas (PostgreSQL) e ia y agentes (MongoDB).
# DynamoDB (Acceso) es un servicio administrado: se respalda activando «Point-in-time recovery» en la tabla (consola de AWS).
# Dónde queda:  respaldos/<vm>/<aaaa-mm-dd>/<base>-<hhmm>.dump   (PostgreSQL, formato custom) o .archive.gz (MongoDB)
# Cómo sube:    con curl (--aws-sigv4), sin instalar nada; las claves salen del .env de la VM y nunca se imprimen.
# Variables del .env (infra/.env): S3_RESPALDO_BUCKET, S3_RESPALDO_ACCESS_KEY, S3_RESPALDO_SECRET_KEY y, opcional,
#   S3_RESPALDO_REGION (us-east-1) y S3_RESPALDO_ENDPOINT (por omisión el S3 de AWS; para pruebas, el SeaweedFS local).
# Sale con código 1 si algún respaldo falla (así cron o un monitor lo notan). Se programa con cron, ver infra/CLAUDE.md.
set -uo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$AQUI/../.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

VM="${1:-${RESPALDO_VM:-}}"
case "$VM" in
  azure) PG_CONT=condohub-postgres-1; PG_BDS="gestion keycloak"; MONGO_CONT=""; MONGO_BDS="" ;;
  gcp)   PG_CONT=gcp-postgres-1; PG_BDS="reservas"; MONGO_CONT=gcp-mongo-1; MONGO_BDS="ia agentes" ;;
  local) PG_CONT=condohub-postgres-1; PG_BDS="gestion reservas"; MONGO_CONT=condohub-mongo-1; MONGO_BDS="ia agentes" ;;
  *) echo "Uso: $0 azure|gcp|local" >&2; exit 2 ;;
esac
for v in S3_RESPALDO_BUCKET S3_RESPALDO_ACCESS_KEY S3_RESPALDO_SECRET_KEY; do
  [ -n "${!v:-}" ] || { echo "Falta $v en $ENV_FILE" >&2; exit 2; }
done

REGION="${S3_RESPALDO_REGION:-us-east-1}"
ENDPOINT="${S3_RESPALDO_ENDPOINT:-https://s3.${REGION}.amazonaws.com}"
FECHA="$(date -u +%F)"
HORA="$(date -u +%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fallos=0

registrar() { echo "$(date -u +%FT%TZ) $*"; }

# Sube un archivo con una petición firmada (SigV4). El cuerpo viaja con UNSIGNED-PAYLOAD, válido sobre HTTPS y en el SeaweedFS local.
subir() {
  curl -sS --fail --max-time 600 --aws-sigv4 "aws:amz:${REGION}:s3" \
    --user "${S3_RESPALDO_ACCESS_KEY}:${S3_RESPALDO_SECRET_KEY}" \
    -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
    -T "$1" "${ENDPOINT}/${S3_RESPALDO_BUCKET}/$2" -o /dev/null
}

respaldar() { # nombre archivo_local extension
  local clave="respaldos/${VM}/${FECHA}/$1-${HORA}.$3"
  if [ ! -s "$2" ]; then
    registrar "ERROR  $1: el volcado salió vacío"
    fallos=$((fallos + 1))
    return
  fi
  if subir "$2" "$clave"; then
    registrar "OK     $1 -> ${clave} ($(wc -c < "$2" | tr -d ' ') bytes)"
  else
    registrar "ERROR  $1: no se pudo subir ${clave}"
    fallos=$((fallos + 1))
  fi
}

for bd in $PG_BDS; do
  if docker exec "$PG_CONT" pg_dump -U postgres -Fc "$bd" > "$TMP/$bd.dump" 2> "$TMP/$bd.err"; then
    respaldar "$bd" "$TMP/$bd.dump" dump
  else
    registrar "ERROR  $bd: pg_dump falló ($(head -c 200 "$TMP/$bd.err" | tr '\n' ' '))"
    fallos=$((fallos + 1))
  fi
done

for bd in $MONGO_BDS; do
  if docker exec "$MONGO_CONT" mongodump --quiet --archive --gzip --db "$bd" > "$TMP/$bd.archive.gz" 2> "$TMP/$bd.err"; then
    respaldar "$bd" "$TMP/$bd.archive.gz" archive.gz
  else
    registrar "ERROR  $bd: mongodump falló ($(head -c 200 "$TMP/$bd.err" | tr '\n' ' '))"
    fallos=$((fallos + 1))
  fi
done

if [ "$fallos" -eq 0 ]; then
  registrar "RESULTADO: respaldo de ${VM} completo"
else
  registrar "RESULTADO: ${fallos} respaldo(s) con error"
  exit 1
fi
