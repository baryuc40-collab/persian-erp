# check=skip=InvalidDefaultArgInFrom
# Persian NocoBase image: the official image of the pinned version plus the built Persian plugin.
# Build with docker/build.sh, which reads the version from NOCOBASE_VERSION and packs the plugin.
ARG NOCOBASE_VERSION
FROM nocobase/nocobase:${NOCOBASE_VERSION}

ARG NOCOBASE_VERSION
ARG PLUGIN_VERSION
ARG MODULES_VERSION
ARG BPM_VERSION
# Release number set by the release workflow (STORY-062); local builds are "dev".
ARG RELEASE=dev

LABEL org.opencontainers.image.title="Persian NocoBase" \
      org.opencontainers.image.description="NocoBase with Persian (fa-IR) localization: RTL, Jalali calendar, Persian font and digits" \
      org.opencontainers.image.source="https://github.com/baryuc40-collab/persian-erp" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.version="${NOCOBASE_VERSION}-fa.${RELEASE}" \
      com.nocobase.version="${NOCOBASE_VERSION}" \
      ir.persian-erp.plugin-fa.version="${PLUGIN_VERSION}" \
      ir.persian-erp.plugin-modules.version="${MODULES_VERSION}" \
      ir.persian-erp.plugin-bpm.version="${BPM_VERSION}"

# Outside storage/: the official compose mounts storage/ as a volume, which would hide anything put there.
# ADD unpacks the local tarball made by `yarn tar`.
ADD plugin-fa.tgz /app/nocobase/node_modules/@persian-erp/plugin-fa/
ADD plugin-modules.tgz /app/nocobase/node_modules/@persian-erp/plugin-modules/
# The process engine plugin is in the image but off: `pm enable @persian-erp/plugin-bpm` turns it on
# (docs/install/README.md). Camunda itself is a separate service of the bpm profile, not in this image.
ADD plugin-bpm.tgz /app/nocobase/node_modules/@persian-erp/plugin-bpm/

# Defaults only; a .env or `environment:` entry overrides each of them.
# Built-in plugins are enabled on install, which a local plugin is not.
ENV APPEND_PRESET_BUILT_IN_PLUGINS=@persian-erp/plugin-fa,@persian-erp/plugin-modules \
    INIT_APP_LANG=fa-IR \
    TZ=Asia/Tehran
