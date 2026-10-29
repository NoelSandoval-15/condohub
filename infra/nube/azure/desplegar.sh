#!/usr/bin/env bash
# Despliega CondoHub (parte de Azure) en esta VM. Se corre desde cualquier carpeta del espacio de trabajo ya montado
# (ver preparar-vm.sh) y con infra/.env completo (ver azure.env.example). Se puede repetir: reconstruye lo que cambió.
set -euo pipefail

INFRA="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$INFRA"
[ -f .env ] || { echo "Falta infra/.env: copia nube/azure/azure.env.example y complétalo" >&2; exit 1; }
set -a
. ./.env
set +a
for v in DOMINIO KEYCLOAK_ADMIN_PASSWORD USUARIOS_PRUEBA_PASSWORD POSTGRES_PASSWORD ACCESO_URL IA_URL RESERVAS_URL AGENTES_URL; do
  [ -n "${!v:-}" ] || { echo "Falta $v en infra/.env" >&2; exit 1; }
done

GEN=nube/azure/generado
mkdir -p "$GEN"

# El gateway: misma configuración que kong.apps.yml, con el `iss` público, los upstreams de las otras nubes y el CORS de los frontends.
sed \
  -e "s#key: http://localhost:8180/realms/condohub#key: https://auth.${DOMINIO}/realms/condohub#" \
  -e "s#http://acceso:3001#${ACCESO_URL}#" \
  -e "s#http://reservas:8082#${RESERVAS_URL}#" \
  -e "s#http://ia:8083#${IA_URL}#" \
  -e "s#http://agentes:8084#${AGENTES_URL}#" \
  -e "s#- http://localhost:5173#- https://app.${DOMINIO}#" \
  -e "s#- http://localhost:5174#- https://residente.${DOMINIO}#" \
  -e "s#- http://localhost:5175#- https://guardia.${DOMINIO}#" \
  -e "s#- http://localhost:4200#- https://admin.${DOMINIO}#" \
  gateway/kong.apps.yml > "$GEN/kong.yml"

# El realm: agrega la URL pública del shell a los redirects y orígenes del cliente web.
jq --arg d "$DOMINIO" '
  (.clients[] | select(.clientId == "condohub-spa")) |= (
    .redirectUris += ["https://app.\($d)/*"] | .webOrigins += ["https://app.\($d)"]
  )' keycloak/realm-condohub.json > "$GEN/realm-condohub.json"

docker compose -f docker-compose.yml -f docker-compose.apps.yml -f nube/azure/docker-compose.azure.yml \
  up -d --build postgres rabbitmq keycloak gestion gateway shell admin residente guardia caddy

echo
echo "Listo. Comprueba: https://auth.${DOMINIO}/realms/condohub  y  https://app.${DOMINIO}"
