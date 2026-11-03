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
#            sent   — file listing the paths offload itself sent to the worker,
#                     one per line, as written in the prompt: these are checked
#                     even outside root (the worker has seen them already)
#            known  — file listing the project's files (relative to root), for
#                     explore, where the worker opened files itself
#
# A cited path that doesn't exist as written ("src/fx/ledger.ts" for "fx/ledger.ts",
# a bare "pre-read") is matched against the sent/known files: when exactly one ends
# with it, or failing that exactly one has its file name, that file is checked and
# the citation is rewritten to its real path, so the agent can open it.
#
# POSIX awk only (macOS ships BSD awk): no gensub, no match() arrays.

function norm(s) { gsub(/[ \t\r]+/, " ", s); sub(/^ /, "", s); sub(/ $/, "", s); return s }

function resolve(p) {
  if (substr(p, 1, 1) == "/") return p
  sub(/^\.\//, "", p)
  return root "/" p
}

# Only regular files of at most 8 MB inside root: a model can cite /dev/zero
# or a FIFO, which must not hang or exhaust memory.
function readable(p, f,    q) {
  q = p; sub(/^\.\//, "", q)
  if (!(q in sentpath)) {
    if (substr(p, 1, 1) == "/" && index(p, root "/") != 1) return 0
    if (p ~ /(^|\/)\.\.(\/|$)/) return 0
  }
  q = f; gsub(/'/, "'\\''", q)
  return system("test -f '" q "' && test \"$(wc -c < '" q "')\" -le 8388608 2>/dev/null") == 0
}

# Loads a file into lines[path, n]; nlines[path] = count (-1 if unreadable).
function load(p,    f, l, n) {
  if (p in nlines) return nlines[p]
  f = resolve(p); n = 0
  if (!readable(p, f)) { nlines[p] = -1; return -1 }
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
  # the worker saw offload's own tags inside the material as "&lt;…" (fenced): read them back
  gsub(/&lt;/, "<", q)
  q = norm(q)
  if (q == "") return 0
  for (i = lo; i <= hi; i++) {
    if (index(norm(lines[p, i]), q) > 0) return 1
  }
  # Quotes can span a line break: try the joined window too.
  hay = ""
  for (i = lo; i <= hi; i++) hay = hay " " lines[p, i]
  hay = norm(hay)
  if (index(hay, q) > 0) return 1
  return elided(hay, q)
}

# A quote shortened with "..." or "…" (`f("$a" ... "end")`): every piece must occur
# in the window, in order, and one piece must be long enough to mean something.
function elided(hay, q,    n, i, part, f, at, pos, longest) {
  gsub(/…/, "...", q)
  if (index(q, "...") == 0) return 0
  n = split(q, part, /\.\.\.+/)
  pos = 1; longest = 0
  for (i = 1; i <= n; i++) {
    f = norm(part[i])
    if (f == "") continue
    at = index(substr(hay, pos), f)
    if (at == 0) return 0
    pos += at + length(f) - 1
    if (length(f) > longest) longest = length(f)
  }
  return longest >= 6
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

# True when citation c occurs again in s as a whole citation (not inside a longer
# path, not as the start of a longer line number).
function again(s, c,    i, n, x, y) {
  n = length(c)
  while ((i = index(s, c)) > 0) {
    x = (i > 1 ? substr(s, i - 1, 1) : "")
    y = substr(s, i + n, 1)
    if (x !~ /[A-Za-z0-9_.@\/+-]/ && y !~ /[0-9-]/) return 1
    s = substr(s, i + n)
  }
  return 0
}

function remember(k,    b) {
  if (k == "" || (k in isknown)) return
  isknown[k] = 1; nknown++; knownat[nknown] = k
  b = k; sub(/.*\//, "", b)
  bcount[b]++; bpath[b] = k
}

# The file a citation means: as written when it exists, else the one sent/known
# file it uniquely names (by path suffix, then by file name); "" when unsure.
function locate(p,    q, i, k, n, hit, b) {
  if (load(p) > 0) return p
  q = p; sub(/^\.\//, "", q)
  if (q == "" || nknown == 0) return ""
  n = 0; hit = ""
  for (i = 1; i <= nknown; i++) {
    k = knownat[i]
    # one path ends with the other at a "/" (a shortened, or a longer absolute, form)
    if ((length(k) > length(q) && substr(k, length(k) - length(q)) == "/" q) || (length(q) > length(k) && substr(q, length(q) - length(k)) == "/" k)) { n++; hit = k }
  }
  if (n == 1) return hit
  if (n > 1) return ""
  b = q; sub(/.*\//, "", b)
  if (bcount[b] == 1) return bpath[b]
  return ""
}

BEGIN {
  if (slack == "") slack = 3
  ok = 0; bad = 0
  if (sent != "") {
    while ((getline l < sent) > 0) { sub(/^\.\//, "", l); if (l != "") { sentpath[l] = 1; remember(l) } }
    close(sent)
  }
  if (known != "") {
    while ((getline l < known) > 0 && nknown < 50000) { sub(/^\.\//, "", l); remember(l) }
    close(known)
  }
}

# Very long lines (minified output) are passed through unscanned.
length($0) > 4000 { print; next }

{
  line = $0
  rest = line
  marked = 0
  outl = ""     # the line as printed: citations repaired to the file they mean
  # Walk every citation on the line.
  # `path:L12` — or `path:12` when path is a file offload sent or knows (so `host:8080`
  # and `10:30` stay plain text)
  while (match(rest, /[A-Za-z0-9_.@\/+-]+:L?[0-9]+(-L?[0-9]+)?/)) {
    cite = substr(rest, RSTART, RLENGTH)
    before = substr(rest, 1, RSTART - 1)
    after = substr(rest, RSTART + RLENGTH)
    # a backticked citation keeps its closing backtick, so that backtick never opens
    # the next citation's quote
    bt = (substr(before, length(before), 1) == "`" && substr(after, 1, 1) == "`")
    rest = (bt ? substr(after, 2) : after)
    outl = outl before cite
    c = index(cite, ":")
    path = substr(cite, 1, c - 1)
    range = substr(cite, c + 1); sub(/^L/, "", range)
    q = path; sub(/^\.\//, "", q)
    if (substr(cite, c + 1, 1) != "L" && !(q in isknown)) { if (bt) outl = outl "`"; continue }
    d = index(range, "-")
    if (d > 0) { a = substr(range, 1, d - 1) + 0; b = substr(range, d + 1); sub(/^L/, "", b); b = b + 0 }
    else { a = range + 0; b = a }
    # Candidate quotes: the first backtick span after the citation (skipping
    # the backtick that closes a backticked citation), else the last complete
    # span before it — models write both "path:L3 `code`" and "`code` at path:L3".
    qa = ""; t = after
    sub(/^`/, "", t)
    s = index(t, "`")
    qa2 = ""
    if (s > 0) {
      t = substr(t, s + 1); e = index(t, "`")
      if (e > 0) {
        qa = substr(t, 1, e - 1)
        # "path:L4 in `fn()`: `code`" — the second span, if it comes before the next citation
        t = substr(t, e + 1); s = index(t, "`")
        if (s > 0 && !match(substr(t, 1, s), /[A-Za-z0-9_.@\/+-]+:L?[0-9]/)) { t = substr(t, s + 1); e = index(t, "`"); if (e > 0) qa2 = substr(t, 1, e - 1) }
      }
    }
    qb = lastspan(before)
    # Very short spans (`x`, `id`) would "match" almost any line.
    if (length(norm(qa)) < 3) qa = ""
    if (length(norm(qa2)) < 3) qa2 = ""
    if (length(norm(qb)) < 6) qb = ""
    # the same citation again later on the line ("`f.py:L4` in `fn()`: `f.py:L4` `code`")
    # is checked there, where its quote is
    if (again(after, cite)) qa = qa2 = qb = ""
    if (qa != "" || qa2 != "" || qb != "") {
      real = locate(path)
      if (real != "" && ((qa != "" && check(real, a, b, qa)) || (qa2 != "" && check(real, a, b, qa2)) || (qb != "" && check(real, a, b, qb)))) {
        ok++
        if (real != path) outl = substr(outl, 1, length(outl) - length(cite)) real substr(cite, c)
      }
      else { bad++; marked = 1 }
    }
    if (bt) outl = outl "`"
  }
  outl = outl rest
  if (marked) print outl " ⚠unverified"
  else print outl
}

END { if (report != "") { print ok " " bad > report; close(report) } }
