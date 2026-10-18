#!/usr/bin/env bash
# Snapshot everything on the given PRs (default 1-6) into data/pr-<n>.json. Re-runnable.
set -euo pipefail
export GH_TOKEN=$(gh auth token --user GauravChopada)
R=GauravChopada/ledgerline
out="$(cd "$(dirname "$0")" && pwd)/data"
for n in "${@:-1 2 3 4 5 6}"; do
  for n1 in $n; do
    sha=$(gh pr view "$n1" -R $R --json headRefOid -q .headRefOid)
    jq -n \
      --argjson pr "$(gh pr view "$n1" -R $R --json number,title,state,headRefName,headRefOid,createdAt,reviewDecision,labels)" \
      --argjson issue_comments "$(gh api --paginate repos/$R/issues/$n1/comments)" \
      --argjson reviews "$(gh api --paginate repos/$R/pulls/$n1/reviews)" \
      --argjson review_comments "$(gh api --paginate repos/$R/pulls/$n1/comments)" \
      --argjson check_runs "$(gh api repos/$R/commits/$sha/check-runs)" \
      --argjson reactions "$(gh api repos/$R/issues/$n1/reactions)" \
      '{pr:$pr, issue_comments:$issue_comments, reviews:$reviews, review_comments:$review_comments, check_runs:$check_runs.check_runs, reactions:$reactions, captured_at:(now|todate)}' \
      > "$out/pr-$n1.json"
    echo "pr-$n1: $(jq -r '[(.issue_comments|length), (.reviews|length), (.review_comments|length), (.check_runs|length)]|@csv' "$out/pr-$n1.json") (issue_comments,reviews,review_comments,check_runs)"
  done
done
