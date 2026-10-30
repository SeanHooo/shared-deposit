#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

idl="programs/shared-deposit-v2/idl/shared_deposit_v2.json"
generated_dir="app/src/generated-v2"
test -f "$idl"
test -d "$generated_dir"

snapshot_dir="$(mktemp -d)"
trap 'rm -rf "$snapshot_dir"' EXIT
cp -R "$generated_dir" "$snapshot_dir/generated-v2"

npm --prefix app run generate:v2

if ! diff -ru "$snapshot_dir/generated-v2" "$generated_dir"; then
  echo "Generated v2 client differs from the committed IDL output." >&2
  exit 1
fi

echo "Generated v2 client matches the committed IDL."
