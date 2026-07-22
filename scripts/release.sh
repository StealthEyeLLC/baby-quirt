#!/usr/bin/env bash
# Full source gate plus signed, reproducible candidate production. Never deploys.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
VERSION="${1:-$(node -p "require('./package.json').version")}"
GATE_ROOT="$(mktemp -d /tmp/baby-quirt-release-gates.XXXXXX)"
GATE_RESULTS="$GATE_ROOT/results.tsv"
TEST_EVIDENCE="${BABY_QUIRT_TEST_EVIDENCE_PATH:-$GATE_ROOT/baby-quirt-${VERSION}.test-evidence.json}"
trap 'rm -rf -- "$GATE_ROOT"' EXIT
mkdir "$GATE_ROOT/home"
export HOME="$GATE_ROOT/home"
export NPM_CONFIG_CACHE="${BABY_QUIRT_NPM_CACHE:-$GATE_ROOT/npm-cache}"

record_plain_gate() {
  local name="$1"
  local command="$2"
  local count="$3"
  shift 3
  "$@"
  printf '%s\t%s\t%s\n' "$name" "$count" "$command" >> "$GATE_RESULTS"
}

record_test_gate() {
  local name="$1"
  local command="$2"
  shift 2
  local log="$GATE_ROOT/${name}.tap"
  NODE_OPTIONS="${NODE_OPTIONS:-} --test-reporter=tap" "$@" 2>&1 | tee "$log"
  local count
  count="$(awk '/^# tests [0-9]+$/ { total += $3; found = 1 } END { if (found) print total; else print 0 }' "$log")"
  test "$count" -gt 0
  printf '%s\t%s\t%s\n' "$name" "$count" "$command" >> "$GATE_RESULTS"
}

record_plain_gate dependencies 'npm ci --include=dev' 0 \
  npm --cache "$NPM_CONFIG_CACHE" ci --include=dev
record_plain_gate lint 'npm run lint' 0 npm run lint
record_plain_gate build-native 'npm run build:native' 0 npm run build:native
record_plain_gate build 'npm run build' 0 npm run build
record_test_gate unit 'npm run test' npm run test
record_test_gate integration 'npm run test:integration' npm run test:integration
record_test_gate acceptance 'npm run test:acceptance' npm run test:acceptance
record_plain_gate contracts 'npm run test:contracts' 1 npm run test:contracts
record_test_gate aggregate 'npm run test:all' npm run test:all

COMMIT="${BABY_QUIRT_SOURCE_COMMIT:-$(git rev-parse HEAD)}"
TREE="${BABY_QUIRT_SOURCE_TREE:-$(git show -s --format=%T "$COMMIT")}"
node dist/src/cli/write-test-evidence.js \
  --gate-results "$GATE_RESULTS" \
  --output "$TEST_EVIDENCE" \
  --source-commit "$COMMIT" \
  --source-tree "$TREE"

export BABY_QUIRT_TEST_EVIDENCE_PATH="$TEST_EVIDENCE"
bash scripts/build-release.sh "$VERSION"
