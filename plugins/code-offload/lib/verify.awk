# offload — citation verifier.
#
# Reads a worker answer on stdin. For every line that cites
# `path:L<start>[-L<end>]` together with a backtick quote, checks that the
# quote (whitespace-normalised) occurs in that file within ±SLACK lines of the
# cited range. Unverifiable citations get a " ⚠unverified" marker; the answer
# is otherwise passed through unchanged.
#
# Variables: root   — directory relative paths are resolved against
#            slack  — line tolerance (default 3)
#            report — file to write "verified unverified" counts to
#
# POSIX awk only (macOS ships BSD awk): no gensub, no match() arrays.

function norm(s) { gsub(/[ \t\r]+/, " ", s); sub(/^ /, "", s); sub(/ $/, "", s); return s }

function resolve(p) {
  if (substr(p, 1, 1) == "/") return p
  sub(/^\.\//, "", p)
  return root "/" p
}

# Loads a file into lines[path, n]; nlines[path] = count (-1 if unreadable).
function load(p,    f, l, n) {
  if (p in nlines) return nlines[p]
  f = resolve(p); n = 0
  while ((getline l < f) > 0) { n++; lines[p, n] = l }
  close(f)
  nlines[p] = (n > 0 ? n : -1)
  return nlines[p]
}

function check(p, a, b, q,    n, i, lo, hi, hay) {
  n = load(p)
  if (n < 0) return 0
  if (b < a) b = a
  lo = a - slack; hi = b + slack
  if (lo < 1) lo = 1
  if (hi > n) hi = n
  q = norm(q)
  if (q == "") return 0
  for (i = lo; i <= hi; i++) {
    if (index(norm(lines[p, i]), q) > 0) return 1
  }
  # Quotes can span a line break: try the joined window too.
  hay = ""
  for (i = lo; i <= hi; i++) hay = hay " " lines[p, i]
  return index(norm(hay), q) > 0
}

# Last complete `...` span in s (ignoring a trailing unmatched backtick).
function lastspan(s,    n, i, c, open, cur, last) {
  n = length(s); open = 0; cur = ""; last = ""
  for (i = 1; i <= n; i++) {
    c = substr(s, i, 1)
    if (c == "`") { if (open) { last = cur; open = 0 } else { open = 1; cur = "" } }
    else if (open) cur = cur c
  }
  return last
}

BEGIN { if (slack == "") slack = 3; ok = 0; bad = 0 }

{
  line = $0
  rest = line
  marked = 0
  # Walk every citation on the line.
  while (match(rest, /[A-Za-z0-9_.@\/+-]+:L[0-9]+(-L?[0-9]+)?/)) {
    cite = substr(rest, RSTART, RLENGTH)
    before = substr(rest, 1, RSTART - 1)
    after = substr(rest, RSTART + RLENGTH)
    rest = after
    c = index(cite, ":L")
    path = substr(cite, 1, c - 1)
    range = substr(cite, c + 2)
    d = index(range, "-")
    if (d > 0) { a = substr(range, 1, d - 1) + 0; b = substr(range, d + 1); sub(/^L/, "", b); b = b + 0 }
    else { a = range + 0; b = a }
    # Candidate quotes: the first backtick span after the citation (skipping
    # the backtick that closes a backticked citation), else the last complete
    # span before it — models write both "path:L3 `code`" and "`code` at path:L3".
    qa = ""; t = after
    sub(/^`/, "", t)
    s = index(t, "`")
    if (s > 0) { t = substr(t, s + 1); e = index(t, "`"); if (e > 0) qa = substr(t, 1, e - 1) }
    qb = lastspan(before)
    # Very short spans (`x`, `id`) would "match" almost any line.
    if (length(norm(qa)) < 3) qa = ""
    if (length(norm(qb)) < 6) qb = ""
    if (qa == "" && qb == "") continue
    if ((qa != "" && check(path, a, b, qa)) || (qb != "" && check(path, a, b, qb))) ok++
    else { bad++; marked = 1 }
  }
  if (marked) print line " ⚠unverified"
  else print line
}

END { if (report != "") { print ok " " bad > report; close(report) } }
