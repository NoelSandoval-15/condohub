#!/usr/bin/env bash
# Prepara una VM Ubuntu 24.04 limpia de AWS: swap de 2 GB (la compilación de Next.js lo necesita), Docker y los repos
# que esta VM construye (la raíz y Acceso) en ~/condohub. Se corre una vez: `bash preparar-vm.sh`.
set -euo pipefail

if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
fi

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
clonar github.com/luisrepo25/condohub-acceso.git condohub/services/acceso

echo
echo "Listo. Cierra la sesión y vuelve a entrar (para usar Docker sin sudo)."
echo "Luego: cp ~/condohub/infra/nube/aws/aws.env.example ~/condohub/infra/.env, completa los valores y corre desplegar.sh."
