#!/bin/bash
# Verify a Judge0 host end to end — every language, every outcome.
#
# Runs ON the judge host (it has no external IP), against localhost:2358.
#
# WHY EVERY LANGUAGE INDIVIDUALLY. "It works in Python" says nothing about Rust.
# Each language has its own compile step, its own error signatures, and its own
# id on this instance. A dropdown where three of nine silently fail is worse than
# a dropdown with six entries, because the candidate cannot tell whose fault it is.
#
# WHY EVERY OUTCOME. Accepted is the easy half. A judge that reports a timeout as
# a wrong answer, or a compile error as an internal error, produces scores that
# look plausible and are wrong — which is harder to notice than an outright break.
set -uo pipefail

TOKEN="${JUDGE0_TOKEN:-}"
BASE="${JUDGE0_URL:-http://localhost:2358}"
if [ -z "$TOKEN" ]; then echo "JUDGE0_TOKEN not set"; exit 2; fi

# Stamped so a reader (or a poller) can tell WHICH run they are looking at: the
# serial console accumulates, and two runs of this script are otherwise identical
# in shape. Bump it with any change to what is checked.
VERIFY_REVISION=4
echo "JUDGE0_VERIFY_START revision=${VERIFY_REVISION}"

PASS=0; FAIL=0
declare -a FAILURES=()

# Submit source + stdin + expected, poll to a terminal state, echo the status name.
run_case() {
  local lang_id="$1" source="$2" stdin="$3" expected="$4" cpu="${5:-5}"
  local body token status desc
  body=$(python3 -c '
import base64, json, sys
lang, src, stdin, exp, cpu = sys.argv[1:6]
b = lambda s: base64.b64encode(s.encode()).decode()
print(json.dumps({
  "language_id": int(lang), "source_code": b(src), "stdin": b(stdin),
  "expected_output": b(exp) if exp else None,
  "cpu_time_limit": float(cpu), "wall_time_limit": float(cpu) * 2 + 5,
  "memory_limit": 262144, "enable_network": False,
}))' "$lang_id" "$source" "$stdin" "$expected" "$cpu")

  token=$(curl -sS -m 20 -X POST "$BASE/submissions?base64_encoded=true" \
    -H "X-Auth-Token: $TOKEN" -H "Content-Type: application/json" -d "$body" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')
  if [ -z "$token" ]; then echo "NO_TOKEN"; return; fi

  for _ in $(seq 1 40); do
    sleep 1
    out=$(curl -sS -m 20 "$BASE/submissions/$token?base64_encoded=true" -H "X-Auth-Token: $TOKEN")
    status=$(echo "$out" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("status") or {}).get("id",0))')
    if [ "$status" != "1" ] && [ "$status" != "2" ]; then
      desc=$(echo "$out" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("status") or {}).get("description",""))')
      echo "$desc"
      return
    fi
  done
  echo "NEVER_FINISHED"
}

# A sandbox check that passes because NOTHING RAN is worse than no check: it
# certifies isolation on the strength of a submission that was never made. This
# asserts a NAMED verdict instead of "anything but Accepted", so NO_TOKEN and
# NEVER_FINISHED fail the check rather than satisfying it.
check_blocked() {
  local label="$1" actual="$2"; shift 2
  local allowed
  for allowed in "$@"; do
    if [ "$actual" = "$allowed" ]; then
      printf '  PASS  %-46s %s\n' "$label" "$actual"; PASS=$((PASS+1)); return
    fi
  done
  printf '  FAIL  %-46s got "%s", wanted one of: %s\n' "$label" "$actual" "$*"
  FAIL=$((FAIL+1)); FAILURES+=("$label")
}

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf '  PASS  %-46s %s\n' "$label" "$actual"; PASS=$((PASS+1))
  else
    printf '  FAIL  %-46s got "%s", wanted "%s"\n' "$label" "$actual" "$expected"
    FAIL=$((FAIL+1)); FAILURES+=("$label")
  fi
}

# Resolve this instance's ids for the nine canonical languages, newest per
# toolchain — the same rule the backend applies, so the ids under test are the
# ids production will use.
echo "=== resolving language ids on this judge ==="
IDS=$(curl -sS -m 20 "$BASE/languages" -H "X-Auth-Token: $TOKEN" | python3 -c '
import sys, json, re
langs = json.load(sys.stdin)
FAM = [("python",("Python (3",)),("javascript",("JavaScript (Node.js",)),
       ("typescript",("TypeScript (",)),("java",("Java (JDK","Java (OpenJDK")),
       ("cpp",("C++ (GCC","C++ (Clang")),("c",("C (GCC","C (Clang")),
       ("csharp",("C# (Mono","C# (")),("go",("Go (",)),("rust",("Rust (",))]
def ver(n):
    m = re.findall(r"\d+(?:\.\d+)*", n)
    return tuple(int(p) for p in m[-1].split(".")) if m else ()
for key, prefixes in FAM:
    for p in prefixes:
        hits = [l for l in langs if l["name"].startswith(p)]
        if hits:
            best = max(hits, key=lambda l: ver(l["name"]))
            print("%s %s %s" % (key, best["id"], best["name"]))
            break
')
echo "$IDS" | sed 's/^/  /'
RESOLVED=$(echo "$IDS" | grep -c .)
if [ "$RESOLVED" -lt 9 ]; then
  echo "  FAIL  resolved only ${RESOLVED} of 9 canonical languages on this judge"
  FAIL=$((FAIL+1)); FAILURES+=("language resolution")
fi

# ── every language: read two ints from stdin, print the sum ──────────────────
echo
echo "=== all nine languages, accepted path ==="
while read -r key id name; do
  [ -z "$key" ] && continue
  case "$key" in
    python)     SRC='import sys
a,b=map(int,sys.stdin.read().split())
print(a+b)' ;;
    javascript) SRC='const d=require("fs").readFileSync(0,"utf8").trim().split(/\s+/).map(Number);console.log(d[0]+d[1]);' ;;
    typescript) SRC='declare const require: (name: string) => any;
const d: number[] = require("fs").readFileSync(0,"utf8").trim().split(/\s+/).map(Number); console.log(d[0]+d[1]);' ;;
    java)       SRC='import java.util.*;
public class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println(s.nextInt()+s.nextInt());}}' ;;
    cpp)        SRC='#include <iostream>
int main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<std::endl;}' ;;
    c)          SRC='#include <stdio.h>
int main(){long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\n",a+b);return 0;}' ;;
    csharp)     SRC='using System;class P{static void Main(){var p=Console.ReadLine().Split();Console.WriteLine(long.Parse(p[0])+long.Parse(p[1]));}}' ;;
    go)         SRC='package main
import "fmt"
func main(){var a,b int64;fmt.Scan(&a,&b);fmt.Println(a+b)}' ;;
    rust)       SRC='use std::io::Read;
fn main(){let mut s=String::new();std::io::stdin().read_to_string(&mut s).unwrap();let v:Vec<i64>=s.split_whitespace().map(|x|x.parse().unwrap()).collect();println!("{}",v[0]+v[1]);}' ;;
    *) continue ;;
  esac
  check "$key ($name)" "Accepted" "$(run_case "$id" "$SRC" "2 3" "5" 10)"
done <<< "$IDS"

PY_ID=$(echo "$IDS" | awk '$1=="python"{print $2}')
CPP_ID=$(echo "$IDS" | awk '$1=="cpp"{print $2}')

# ── every outcome, so a misreported verdict cannot hide ─────────────────────
echo
echo "=== outcomes ==="
check "wrong answer" "Wrong Answer" \
  "$(run_case "$PY_ID" 'print(999)' "2 3" "5" 5)"
check "compile error (C++)" "Compilation Error" \
  "$(run_case "$CPP_ID" 'int main(){ this is not c++ }' "" "" 5)"
check "runtime error (division by zero)" "Runtime Error (NZEC)" \
  "$(run_case "$PY_ID" 'print(1//0)' "" "" 5)"
check "time limit exceeded" "Time Limit Exceeded" \
  "$(run_case "$PY_ID" 'while True: pass' "" "" 2)"

# ── the sandbox itself ──────────────────────────────────────────────────────
echo
echo "=== sandbox isolation ==="
# Network must be unreachable. A submission that resolves DNS or opens a socket
# means ALLOW_ENABLE_NETWORK is not doing its job.
NET=$(run_case "$PY_ID" 'import socket
socket.setdefaulttimeout(3)
socket.create_connection(("142.250.183.206", 80))
print("NETWORK_REACHED")' "" "NETWORK_REACHED" 5)
# The connect raises, so the program exits non-zero. Wrong Answer is allowed
# too — it also proves the program RAN and did not print NETWORK_REACHED — but
# Accepted, NO_TOKEN and NEVER_FINISHED are all failures.
check_blocked "no network access" "$NET" \
  "Runtime Error (NZEC)" "Runtime Error (Other)" "Wrong Answer"

# Memory limit must bite.
MEM=$(run_case "$PY_ID" 'x = bytearray(400*1024*1024)
print(len(x))' "" "" 5)
# A 400 MB allocation under a 256 MB cap must produce an ERROR verdict. Only
# error verdicts count: "it was not Accepted" would also be true of a
# submission the judge never received.
check_blocked "memory limit enforced" "$MEM" \
  "Runtime Error (NZEC)" "Runtime Error (Other)" "Memory Limit Exceeded"

# Authentication must be on.
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$BASE/languages")
case "$UNAUTH" in
  401|403) printf '  PASS  %-46s HTTP %s\n' "API requires authentication" "$UNAUTH"; PASS=$((PASS+1));;
  *) printf '  FAIL  %-46s HTTP %s — this is an open RCE endpoint\n' "API requires authentication" "$UNAUTH"; FAIL=$((FAIL+1)); FAILURES+=("authn");;
esac

echo
echo "=================================================="
echo "  PASS: $PASS    FAIL: $FAIL"
[ "$FAIL" -gt 0 ] && printf '  failed: %s\n' "${FAILURES[*]}"
echo "=================================================="
[ "$FAIL" -eq 0 ] && echo "JUDGE0_VERIFY_ALL_PASS" || echo "JUDGE0_VERIFY_FAILURES=$FAIL"
exit 0
