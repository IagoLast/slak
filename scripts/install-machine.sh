#!/usr/bin/env bash
set -euo pipefail

fail() { printf '\n%s\n' "$1" >&2; exit 1; }
command -v node >/dev/null || fail 'Instala Node.js 20 o posterior y vuelve a pegar el comando.'
command -v npm >/dev/null || fail 'No se encuentra npm. Reinstala Node.js y vuelve a intentarlo.'
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail 'Actualiza Node.js a la versión 20 o posterior.'
command -v "${SLAK_ORCA_BIN:-orca}" >/dev/null || fail 'Abre Orca e instala su comando de terminal antes de conectar.'
test -r /dev/tty || fail 'Pega el comando en una terminal interactiva de la máquina que ejecuta Orca.'

slak_origin="${1:?Falta la dirección de Slak}"
slak_code="${2:?Falta el código de conexión}"
slak_tmp="$(mktemp -d)"
trap 'rm -rf "$slak_tmp"' EXIT
printf '\nPreparando la conexión con Slak…\n'
curl --fail --silent --show-error --max-time 60 "$slak_origin/api/machines/install?file=setup" -o "$slak_tmp/setup.mjs"
node "$slak_tmp/setup.mjs" "$slak_origin" "$slak_code" </dev/tty
