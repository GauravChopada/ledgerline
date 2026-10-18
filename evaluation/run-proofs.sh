#!/usr/bin/env bash
# Runs each proof at the exact commit Codzee reviewed (commits listed in answer-key.md).
# Every proof test PASSES while its planted bug is present.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"

run() { # <commit> <proof file> [ENV=value]
  local wt
  wt="$(mktemp -d)"
  git -C "$repo" worktree add -q --detach "$wt" "$1"
  echo "== $2 @ $1"
  (cd "$wt" && npm ci --silent >/dev/null \
    && sed 's#\.\./ledgerline/#../#g' "$here/proofs/$2" > test/_proof.test.ts \
    && env ${3:-} node --test --test-reporter=spec test/_proof.test.ts 2>&1 | grep -E '^(✔|✖)') || true
  git -C "$repo" worktree remove --force "$wt"
}

run f7222f9 pr1.test.ts
run ab44d00 pr2.test.ts
run d0dbe94 pr3.test.ts
run 9577c7b pr4.test.ts TZ=Asia/Kolkata
run 22420c9 pr5.test.ts
