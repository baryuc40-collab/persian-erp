#!/bin/bash
# Prepares Claude Code cloud sessions: env files, dependencies and a local PostgreSQL.
# Local sessions are left alone; developers use docker compose there.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s#^APP_KEY=.*#APP_KEY=$(openssl rand -hex 32)#" .env
fi
[ -f .env.test ] || sed 's#^APP_ENV=.*#APP_ENV=test#' .env > .env.test

# Start a throwaway PostgreSQL when the binaries exist and nothing listens on 5432 yet.
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1 || true)
if [ -n "$PG_BIN" ] && ! pg_isready -h localhost -q 2>/dev/null; then
  PGDATA=/var/tmp/persian-erp-pg
  id postgres >/dev/null 2>&1 || useradd -m postgres
  if [ ! -d "$PGDATA" ]; then
    mkdir -p "$PGDATA" && chown postgres "$PGDATA"
    su postgres -c "$PG_BIN/initdb -D $PGDATA -U postgres -A trust" >/dev/null
  fi
  su postgres -c "$PG_BIN/pg_ctl -D $PGDATA -l $PGDATA/log -o '-k /tmp' start" >/dev/null
  sleep 2
  psql -h localhost -U postgres -tc "select 1 from pg_roles where rolname='nocobase'" | grep -q 1 \
    || psql -h localhost -U postgres -c "create user nocobase password 'nocobase' superuser" >/dev/null
  psql -h localhost -U postgres -tc "select 1 from pg_database where datname='nocobase'" | grep -q 1 \
    || psql -h localhost -U postgres -c "create database nocobase owner nocobase" >/dev/null
fi

# Dependency install can fail when the session's network policy blocks a host
# (NocoBase pulls xlsx from cdn.sheetjs.com). Report it instead of failing the session.
if ! yarn install --ignore-engines --network-timeout 600000 >/tmp/persian-erp-install.log 2>&1; then
  echo "yarn install failed; see /tmp/persian-erp-install.log (cdn.sheetjs.com must be allowed in the environment's network settings)" >&2
fi
