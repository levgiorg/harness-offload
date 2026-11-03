#!/usr/bin/env bash
# Token-savings benchmark with a REAL model (uses your configured backend/model).
#   evals/benchmark.sh [-m provider/model] [--cli PATH_TO_OFFLOAD] [--save-answers PREFIX]
# --save-answers PREFIX writes each read answer into evals/real-answers as PREFIX-<scenario>.md
# (paths as {{DIR}}) and prints the cases.txt lines to add once the unverified ones are checked.
# chars/4 of what the agent would have read vs. what offload returned, plus a
# quality check: each scenario lists facts the answer must mention.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CLI="$ROOT/plugins/harness-offload/bin/offload"
model="" save=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) model="$2"; shift 2 ;;
    --cli) CLI="$2"; shift 2 ;;
    --save-answers) save="$2"; shift 2 ;;
    *) shift ;;
  esac
done
T=$(mktemp -d "${TMPDIR:-/tmp}/offload-bench.XXXXXX")
D="$T/fx"; "$HERE/fixtures/generate.sh" "$D" >/dev/null; cp -r "$HERE/fixtures/warehouse" "$D/"
B="$HERE/benchmarks.json"
sub() { printf '%s' "$1" | sed "s#{{DIR}}#$D#g"; }
tok() { echo $(( ($(wc -c < "$1" | tr -d ' ') + 3) / 4 )); }

printf '%-22s %9s %7s %8s %6s  %s\n' scenario without with savings secs quality
n=$(jq '.scenarios | length' "$B"); i=0
while [ "$i" -lt "$n" ]; do
  name=$(jq -r ".scenarios[$i].name" "$B"); kind=$(jq -r ".scenarios[$i].kind" "$B")
  out="$T/$name.out"; s=$(date +%s)
  paths=$(jq -r ".scenarios[$i].paths // [] | .[]" "$B" | while IFS= read -r p; do sub "$p"; echo; done)
  case "$kind" in
    read)
      # shellcheck disable=SC2086
      cat $paths > "$T/$name.corpus"
      # shellcheck disable=SC2086
      "$CLI" read ${model:+-m "$model"} -q "$(jq -r ".scenarios[$i].question" "$B")" $paths > "$out" 2>&1 ;;
    summarize)
      # shellcheck disable=SC2086
      cat $paths > "$T/$name.corpus"
      # shellcheck disable=SC2086
      "$CLI" summarize ${model:+-m "$model"} -q "$(jq -r ".scenarios[$i].question" "$B")" $paths > "$out" 2>&1 ;;
    write)
      ref=$(sub "$(jq -r ".scenarios[$i].reference" "$B")")
      ctx=$(jq -r ".scenarios[$i].context[]" "$B" | while IFS= read -r p; do printf ' --context %s' "$(sub "$p")"; done)
      # shellcheck disable=SC2086
      cat "$ref" $(jq -r ".scenarios[$i].context[]" "$B" | while IFS= read -r p; do sub "$p"; echo; done) > "$T/$name.corpus"
      # shellcheck disable=SC2086
      "$CLI" write ${model:+-m "$model"} --spec "$(jq -r ".scenarios[$i].spec" "$B")" --ref "$ref" $ctx --out "$T/$name.generated" > "$out" 2>&1
      ;;
  esac
  secs=$(( $(date +%s) - s ))
  cat "$out" "$T/$name.generated" > "$T/$name.check" 2>/dev/null
  hits=0; total=0
  while IFS= read -r must; do
    total=$((total + 1)); grep -qF -- "$must" "$T/$name.check" && hits=$((hits + 1))
  done <<EOF2
$(jq -r ".scenarios[$i].must_mention[]" "$B")
EOF2
  without=$(tok "$T/$name.corpus"); with=$(tok "$out")
  printf '%-22s %9s %7s %7s%% %6s  %s/%s facts\n' "$name" "$without" "$with" $(( (without - with) * 100 / (without > 0 ? without : 1) )) "$secs" "$hits" "$total"
  if [ -n "$save" ] && [ "$kind" = read ]; then
    # the corpus format: offload's own footer lines dropped, the fixture folder as {{DIR}}
    sed -e "s#$T/#{{DIR}}/#g" -e '/^\[offload /d' -e '/^⚠unverified = /d' -e 's/ ⚠unverified$//' "$out" > "$HERE/real-answers/$save-$name.md"
    counts=$(sed -n 's/.*citations: \([0-9]*\) verified, \([0-9]*\) unverified.*/\1 \2/p' "$out" | tail -n 1)
    # shellcheck disable=SC2086
    cases="${cases:-}$save-$name | read | proj | $(echo $paths | sed "s#$T/#{{DIR}}/#g") | ${counts:-? ?}
"
  fi
  i=$((i + 1))
done
echo "outputs: $T"
if [ -n "$save" ] && [ -n "${cases:-}" ]; then
  printf '\nSaved answers in evals/real-answers. Check every unverified citation by hand (a real model slip, or a\nverifier bug to fix?), then add these lines to evals/real-answers/cases.txt:\n%s' "$cases"
fi
