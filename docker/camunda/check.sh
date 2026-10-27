#!/bin/sh
# Checks a running Camunda 8 of the bpm profile (STORY-091): run it in the folder of the docker-compose.yml that
# started it, after `docker compose --profile bpm up -d camunda`. Waits for the engine, then checks that
#   - it is the version of CAMUNDA_VERSION,
#   - the API refuses a request without a password and answers the service user of plugin-bpm,
#   - its secondary storage is the camunda database of the same PostgreSQL,
#   - no port of the engine is published outside Docker.
# Exits non-zero at the first failed check. Uses only what the images have (wget in camunda, psql in postgres).
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
expected="${CAMUNDA_VERSION:-$(tr -d ' \r\n' < "$here/../../CAMUNDA_VERSION")}"
fail() { echo "FAIL: $*" >&2; exit 1; }

# The engine's own wget, so no port has to be published; the service user is read from the engine's environment.
in_camunda() { docker compose exec -T camunda sh -c "$1"; }
AUTH='--user "$CAMUNDA_SECURITY_INITIALIZATION_USERS_0_USERNAME" --password "$CAMUNDA_SECURITY_INITIALIZATION_USERS_0_PASSWORD" --auth-no-challenge'
SEARCH='--post-data="{}" --header="Content-Type: application/json" http://localhost:8080/v2/process-instances/search'
status() { in_camunda "wget -S -O /dev/null $1 2>&1 | awk '/HTTP\\//{code=\$2} END{print code}'"; }

echo "Waiting for the engine to be ready"
i=0
until in_camunda 'wget -q -O /dev/null http://localhost:9600/actuator/health/readiness' 2>/dev/null; do
  i=$((i + 1))
  [ "$i" -le 60 ] || { docker compose logs --tail 200 camunda >&2; fail "the engine is not ready after 5 minutes"; }
  sleep 5
done

version="$(in_camunda "wget -q -O - $AUTH http://localhost:8080/v2/topology" | sed -n 's/.*"gatewayVersion":"\([^"]*\)".*/\1/p')"
[ "$version" = "$expected" ] || fail "the engine is version '$version', CAMUNDA_VERSION is '$expected'"
echo "ok: version $version"

code="$(status "$SEARCH")"
[ "$code" = 401 ] || fail "a request without a password got $code, not 401"
echo "ok: no password, 401"

code="$(status "$AUTH $SEARCH")"
[ "$code" = 200 ] || fail "the service user got $code, not 200"
echo "ok: service user, 200"

tables="$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d camunda -tAc "select count(*) from information_schema.tables where table_schema = current_schema()"')"
[ "${tables:-0}" -gt 0 ] || fail "the camunda database has no tables"
owner="$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d camunda -tAc "select pg_get_userbyid(datdba) from pg_database where datname = current_database()"')"
[ "$owner" = camunda ] || fail "the camunda database belongs to '$owner', not camunda"
echo "ok: secondary storage in the camunda database ($tables tables)"

published="$(docker compose ps --format json camunda | grep -o '"PublishedPort":[1-9][0-9]*' || true)"
[ -z "$published" ] || fail "the engine publishes ports: $published"
echo "ok: no published ports"
