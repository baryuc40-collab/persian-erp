#!/bin/sh
# Builds the Persian NocoBase image from this checkout.
# Usage: docker/build.sh [image-tag]   (default: persian-erp:<NOCOBASE_VERSION>-fa.dev)
# RELEASE=<n> sets the release number in the image version label.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

nocobase_version="$(tr -d ' \r\n' < NOCOBASE_VERSION)"
plugin_version="$(node -p "require('./packages/plugins/@persian-erp/plugin-fa/package.json').version")"
release="${RELEASE:-dev}"
tag="${1:-persian-erp:${nocobase_version}-fa.${release}}"

yarn build @persian-erp/plugin-fa --no-dts
yarn tar @persian-erp/plugin-fa
cp "storage/tar/@persian-erp/plugin-fa-${plugin_version}.tgz" docker/plugin-fa.tgz

docker build \
  --build-arg "NOCOBASE_VERSION=${nocobase_version}" \
  --build-arg "PLUGIN_VERSION=${plugin_version}" \
  --build-arg "RELEASE=${release}" \
  -t "$tag" \
  docker

echo "$tag"
