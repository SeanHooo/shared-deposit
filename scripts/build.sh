#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${HOME}/.cargo/bin:${HOME}/.avm/bin:${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
export NO_DNA=1
cd "$project_dir"
anchor build --no-idl -- --tools-version v1.57
mkdir -p target/idl target/types
anchor idl build --out target/idl/shared_deposit.json --out-ts target/types/shared_deposit.ts

# Keep the committed artifact equal to the build. The test suite deploys the committed
# copy so that it can run without a toolchain (target/ is gitignored), which means a
# build that is not copied here leaves the tests exercising the previous program.
cp target/deploy/shared_deposit.so \
  programs/shared-deposit/artifacts/shared_deposit.so
shasum -a 256 programs/shared-deposit/artifacts/shared_deposit.so
