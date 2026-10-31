#!/usr/bin/env bash
# Carga en el n8n de ESTA VM las credenciales y los flujos de infra/n8n/flows. Se corre después de `desplegar.sh`.
# Los flujos traen direcciones del compose local (keycloak:8080, gateway:8000): aquí se reemplazan por las públicas de Azure.
# Necesita en infra/.env: AZURE_DOMINIO, RABBITMQ_*, SMTP_* y N8N_ENCRYPTION_KEY (ver gcp.env.example). Se puede repetir.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$INFRA"
[ -f .env ] || { echo "Falta infra/.env" >&2; exit 1; }
set -a
. ./.env
set +a
for v in AZURE_DOMINIO RABBITMQ_HOST RABBITMQ_USER RABBITMQ_PASSWORD SMTP_HOST SMTP_USER SMTP_PASSWORD N8N_ENCRYPTION_KEY; do
  [ -n "${!v:-}" ] || { echo "Falta $v en infra/.env (ver nube/gcp/gcp.env.example)" >&2; exit 1; }
done
[ -f secrets/firebase-sa.json ] || echo "AVISO: falta infra/secrets/firebase-sa.json; el push al guardia no funcionará hasta copiarlo a esta VM" >&2

DC=(docker compose --env-file .env -f nube/gcp/docker-compose.gcp.yml)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/flows"

# Las credenciales no viven en el repo: se arman aquí y n8n las guarda cifradas con N8N_ENCRYPTION_KEY.
jq -n --arg rh "$RABBITMQ_HOST" --arg ru "$RABBITMQ_USER" --arg rp "$RABBITMQ_PASSWORD" \
  --arg sh "$SMTP_HOST" --arg sp "${SMTP_PORT:-465}" --arg ss "${SMTP_SECURE:-true}" --arg su "$SMTP_USER" --arg sw "$SMTP_PASSWORD" '[
  {id:"condohub-rabbitmq", name:"CondoHub RabbitMQ", type:"rabbitmq",
   data:{hostname:$rh, port:5672, username:$ru, password:$rp, vhost:"/", ssl:false, passwordless:false}},
  {id:"condohub-smtp", name:"CondoHub SMTP", type:"smtp",
   data:{user:$su, password:$sw, host:$sh, port:($sp|tonumber), secure:($ss=="true"), disableStartTls:false}}]' > "$TMP/credenciales.json"

for f in n8n/flows/*.json; do
  sed -e "s#http://keycloak:8080#https://auth.${AZURE_DOMINIO}#g" \
      -e "s#http://gateway:8000#https://api.${AZURE_DOMINIO}#g" "$f" > "$TMP/flows/$(basename "$f")"
done

# --wait: el primer arranque migra la base de n8n; importar a la vez la corrompe («index already exists»).
"${DC[@]}" up -d --wait n8n
# docker cp deja los archivos a nombre de root: se limpian como root (antes y después), y la contraseña SMTP no queda en el contenedor.
"${DC[@]}" exec -T -u root n8n rm -rf /tmp/credenciales.json /tmp/flows
"${DC[@]}" cp "$TMP/credenciales.json" n8n:/tmp/credenciales.json
"${DC[@]}" cp "$TMP/flows" n8n:/tmp/flows
"${DC[@]}" exec -T n8n n8n import:credentials --input=/tmp/credenciales.json
"${DC[@]}" exec -T n8n n8n import:workflow --separate --input=/tmp/flows
"${DC[@]}" exec -T -u root n8n rm -rf /tmp/credenciales.json /tmp/flows

# Se activa lo que corresponde. «Recordatorio de morosos» (recordatorioMorosos01) queda apagado: manda un correo por unidad.
"${DC[@]}" exec -T n8n n8n update:workflow --all --active=false
for id in evCondoHub000001 pushGuardia01 monitoreoDiario01 tHbDespn2fI9Ti5L F5MEp0Z8iEIPAj7r informeMensual01; do
  "${DC[@]}" exec -T n8n n8n update:workflow --id="$id" --active=true
done
"${DC[@]}" restart n8n

for _ in $(seq 1 30); do
  if "${DC[@]}" exec -T n8n wget -qO- http://127.0.0.1:5678/healthz >/dev/null 2>&1; then
    echo "Listo: n8n activo. Flujos activos:"
    "${DC[@]}" exec -T n8n n8n list:workflow --active=true
    exit 0
  fi
  sleep 2
done
echo "n8n no respondió a tiempo: revisa docker logs gcp-n8n-1" >&2
exit 1
