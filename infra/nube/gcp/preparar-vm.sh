#!/usr/bin/env bash
# Prepara una VM Ubuntu 24.04 limpia de Google Cloud: Docker y los repos que esta VM construye (la raíz y Reservas) en
# ~/condohub. Se corre una vez: `bash preparar-vm.sh`.
set -euo pipefail

sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"

clonar() { # <url sin esquema> <carpeta>
  [ -d "$2/.git" ] && { git -C "$2" pull --ff-only; return; }
  git clone "https://$1" "$2"
}
cd "$HOME"
clonar github.com/NoelSandoval-15/condohub.git condohub
clonar github.com/luisrepo25/condohub-reservas.git condohub/services/reservas

echo
echo "Listo. Cierra la sesión y vuelve a entrar (para usar Docker sin sudo)."
echo "Luego crea infra/.env (ver infra/nube/gcp/gcp.env.example) y corre infra/nube/gcp/desplegar.sh."
