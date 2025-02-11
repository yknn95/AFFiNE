#!/bin/zsh


set -e
set -o pipefail

# packages/frontend/apps/ios/

cd "$(dirname "$0")"
cd ../../../../

if [ ! -d .git ]; then
  echo "[-] .git directory not found at project root"
  exit 1
fi

echo "[+] setting up the project"

yarn install
BUILD_TYPE=canary PUBLIC_PATH="/" yarn workspace @affine/ios build
yarn workspace @affine/ios cap sync

rustup target add aarch64-apple-ios
rustup target add aarch64-apple-ios-sim
rustup target add aarch64-apple-darwin

echo "[+] setup complete"

yarn workspace @affine/ios cap open ios
