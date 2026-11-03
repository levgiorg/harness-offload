# Turns a digest-fixture spec into the tool output it describes (see README.md).
/^# keep: / { next }
/^@@noise [0-9]+ .*@@$/ {
  n = $2 + 0; t = $0
  sub(/^@@noise [0-9]+ /, "", t); sub(/@@$/, "", t)
  for (i = 1; i <= n; i++) { l = t; gsub(/\{i\}/, i, l); print l }
  next
}
{ print }
