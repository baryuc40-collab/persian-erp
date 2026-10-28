#!/bin/sh
# Builds the Persian NocoBase image from this checkout.
# Usage: docker/build.sh [image-tag]   (default: persian-erp:<NOCOBASE_VERSION>-fa.dev)
# RELEASE=<n> sets the release number in the image version label.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

nocobase_version="$(tr -d ' \r\n' < NOCOBASE_VERSION)"
version_of() { node -p "require('./packages/plugins/@persian-erp/$1/package.json').version"; }
plugin_version="$(version_of plugin-fa)"
modules_version="$(version_of plugin-modules)"
bpm_version="$(version_of plugin-bpm)"
release="${RELEASE:-dev}"
tag="${1:-persian-erp:${nocobase_version}-fa.${release}}"

yarn build @persian-erp/plugin-fa @persian-erp/plugin-modules @persian-erp/plugin-bpm --no-dts
for plugin in plugin-fa plugin-modules plugin-bpm; do
  yarn tar "@persian-erp/${plugin}"
  cp "storage/tar/@persian-erp/${plugin}-$(version_of "$plugin").tgz" "docker/${plugin}.tgz"
done

docker build \
  --build-arg "NOCOBASE_VERSION=${nocobase_version}" \
  --build-arg "PLUGIN_VERSION=${plugin_version}" \
  --build-arg "MODULES_VERSION=${modules_version}" \
  --build-arg "BPM_VERSION=${bpm_version}" \
  --build-arg "RELEASE=${release}" \
  -t "$tag" \
  docker

echo "$tag"
