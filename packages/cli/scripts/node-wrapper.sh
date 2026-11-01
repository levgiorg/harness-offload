#!/usr/bin/env bash
# Runs the built CLI with node; resolves symlinks so it can be linked anywhere.
src="$0"
while [ -h "$src" ]; do
  dir=$(cd -P "$(dirname "$src")" && pwd); src=$(readlink "$src")
  case "$src" in /*) ;; *) src="$dir/$src" ;; esac
done
exec node "$(cd -P "$(dirname "$src")" && pwd)/cli.js" "$@"
