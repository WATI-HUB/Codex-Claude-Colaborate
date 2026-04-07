#!/bin/zsh

SCRIPT_DIR="${0:A:h}"
exec node "$SCRIPT_DIR/src/cli.mjs" "$@"
