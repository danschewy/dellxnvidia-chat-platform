#!/bin/zsh
set -euo pipefail

source_dir="${0:A:h}"
project_dir="${source_dir:h:h}"
hub_url="http://127.0.0.1:3310/"

if ! curl --fail --silent --max-time 2 "${hub_url}" >/dev/null; then
  echo "Opening an SSH tunnel to the GB10. Enter the Dell password if prompted."
  ssh \
    -o ExitOnForwardFailure=yes \
    -fN \
    -L 127.0.0.1:3310:127.0.0.1:3100 \
    dell@10.0.0.88
fi

defaults write local.eve.hub EveHubURL "${hub_url}"
open "${project_dir}/dist/Eve.app"

echo "Eve is connected at ${hub_url}. Press Option+Space to open it."
