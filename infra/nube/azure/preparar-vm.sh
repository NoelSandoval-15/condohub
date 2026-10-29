#!/usr/bin/env bash
# Prepara una VM Ubuntu 22.04 limpia de Azure: instala Docker y monta el espacio de trabajo de CondoHub en ~/condohub
# (la raíz y solo los repos que esta VM construye). Se corre una vez, con `bash preparar-vm.sh`.
# Si los repositorios son privados, exporta antes GH_TOKEN con tu token de GitHub (escríbelo tú en la terminal; no lo compartas).
set -euo pipefail

sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

AUTH=""
[ -n "${GH_TOKEN:-}" ] && AUTH="${GH_TOKEN}@"
clonar() { # <url sin esquema> <carpeta>
  [ -d "$2/.git" ] && { git -C "$2" pull --ff-only; return; }
  git clone "https://${AUTH}$1" "$2"
  # El token no debe quedar guardado en la configuración del repo.
  git -C "$2" remote set-url origin "https://$1"
}

cd "$HOME"
clonar github.com/NoelSandoval-15/condohub.git condohub
clonar github.com/luisrepo25/condohub-gestion.git condohub/services/gestion
for f in shell admin residente guardia; do
  clonar "github.com/luisrepo25/condohub-$f.git" "condohub/frontends/$f"
done

echo
echo "Listo. Cierra la sesión y vuelve a entrar (para que Docker funcione sin sudo)."
echo "Luego: cp ~/condohub/infra/nube/azure/azure.env.example ~/condohub/infra/.env, completa los valores y corre desplegar.sh."
