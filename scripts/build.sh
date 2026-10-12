#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:${HOME}/.avm/bin:${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
export NO_DNA=1
cd "$project_dir"
anchor build --no-idl -- --tools-version v1.57
mkdir -p target/idl target/types
anchor idl build --out target/idl/shared_deposit_passport.json --out-ts target/types/shared_deposit_passport.ts
