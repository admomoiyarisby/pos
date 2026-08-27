#!/usr/bin/env bash
set -euo pipefail

compose_file="docker-compose.test.yml"
test_url="${TEST_DATABASE_URL:-postgresql://omoiyari_test:omoiyari_test@localhost:5433/omoiyari_pos_test}"

case "${1:-test}" in
  up)
    docker compose -f "$compose_file" up -d --wait
    ;;
  down)
    docker compose -f "$compose_file" down
    ;;
  reset)
    docker compose -f "$compose_file" down -v
    docker compose -f "$compose_file" up -d --wait
    ;;
  test)
    docker compose -f "$compose_file" up -d --wait
    TEST_DATABASE_URL="$test_url" DATABASE_URL= vp test run
    ;;
  *)
    printf 'Usage: %s {up|down|reset|test}\n' "$0" >&2
    exit 2
    ;;
esac
