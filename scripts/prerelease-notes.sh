#!/usr/bin/env bash
set -Eeuo pipefail

: "${SHA:?SHA is required}"
intro="${1:?usage: prerelease-notes.sh <intro>}"

base="$(git describe --tags --abbrev=0 --match 'v*' --exclude '*-*' "$SHA" 2>/dev/null || true)"
range="$SHA"
if [ -n "$base" ]; then
  range="$base..$SHA"
fi

printf '%s\n' "$intro"
git log --no-merges --max-count=200 --format='%s%x09%h' "$range" | awk -F '\t' -v base="$base" '
  /^chore\(release\)/ || /\[skip ci\]/ { next }
  {
    type = "other"
    if ($1 ~ /^feat/) type = "feat"
    else if ($1 ~ /^fix/) type = "fix"
    else if ($1 ~ /^perf/) type = "perf"
    lines[type] = lines[type] "- " $1 " (" $2 ")\n"
    count++
  }
  END {
    since = base == "" ? "" : " since " base
    if (count == 0) {
      printf "\nNo changes%s.\n", since
      exit
    }
    printf "\n## Changes%s\n", since
    split("feat fix perf other", order, " ")
    titles["feat"] = "Features"
    titles["fix"] = "Fixes"
    titles["perf"] = "Performance"
    titles["other"] = "Other"
    for (i = 1; i <= 4; i++) {
      if (order[i] in lines) printf "\n### %s\n\n%s", titles[order[i]], lines[order[i]]
    }
  }
'
