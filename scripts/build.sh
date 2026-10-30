#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:${HOME}/.avm/bin:${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
export NO_DNA=1
cd "$project_dir"
v2_idl_dir="programs/shared-deposit-v2/idl"
v2_idl="shared_deposit_v2.json"
anchor build -p shared-deposit --no-idl -- --tools-version v1.57
mkdir -p target/idl target/types
anchor idl build -p shared-deposit \
  --out target/idl/shared_deposit.json \
  --out-ts target/types/shared_deposit.ts

anchor build -p shared-deposit-v2 --no-idl -- --tools-version v1.57
anchor idl build -p shared-deposit-v2 \
  --out "target/idl/${v2_idl}" \
  --out-ts target/types/shared_deposit_v2.ts
mkdir -p "$v2_idl_dir"
cp "target/idl/${v2_idl}" "${v2_idl_dir}/${v2_idl}"

# The v1 artifact is pinned to the historical devnet deployment. Only the v2
# release-candidate artifacts are refreshed by this build.
mkdir -p programs/shared-deposit-v2/artifacts
cp target/deploy/shared_deposit_v2.so \
  programs/shared-deposit-v2/artifacts/shared_deposit_v2.so
shasum -a 256 "${v2_idl_dir}/${v2_idl}"
shasum -a 256 programs/shared-deposit-v2/artifacts/shared_deposit_v2.so
