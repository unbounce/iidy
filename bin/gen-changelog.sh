#!/usr/bin/env bash
IFS=":" read -r previous current < <(git tag --sort 'version:refname' | tail -n2 | paste -sd':' -)
ROOT_DIR="$(git rev-parse --show-toplevel)"
npx ts-node "${ROOT_DIR}/bin/gen-changelog.ts" --from "${previous}" --to "${current}"
