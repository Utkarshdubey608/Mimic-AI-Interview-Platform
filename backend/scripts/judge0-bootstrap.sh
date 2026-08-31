#!/bin/bash
# Judge0 host bootstrap — runs as the VM's startup-script, on every boot.
#
# Idempotent in two phases, because the first phase requires a REBOOT:
#   phase 1  cgroup v1 in GRUB, docker, then reboot
#   phase 2  fetch Judge0, configure it, bring it up
#
# WHY THE REBOOT IS UNAVOIDABLE. Judge0 v1.13.1's sandbox (`isolate`) is pinned to
# the cgroup-v1-era flags (--cg, --cg-mem, --cg-timing), so the HOST KERNEL must be
# booted with systemd.unified_cgroup_hierarchy=0. That is a kernel command line,
# which is why this cannot be Cloud Run or GKE and has to be a VM we own.
#
# The three hardening items below are NOT Judge0 defaults, and each is a real hole
# if left alone:
#   AUTHN_TOKEN          ships EMPTY — anyone who reaches :2358 can execute code
#   ALLOW_ENABLE_NETWORK ships TRUE  — lets the API CALLER turn on network access
#                                      per submission, which was half the
#                                      precondition for CVE-2024-29021 (CVSS 9.0)
#   MAX_* limits         bound what one submission can cost the shared host
#
# Progress is written to the serial console so it can be watched without SSH.
set -euo pipefail
exec > >(tee /var/log/judge0-bootstrap.log | logger -t judge0-bootstrap -s 2>/dev/console) 2>&1

JUDGE0_VERSION="1.13.1"
PROJECT_NUMBER="14029160874"
SECRET_NAME="judge0-authn-token"
MARK=/var/lib/judge0-bootstrap-v2
mkdir -p "$MARK"

say() { echo "=== JUDGE0_BOOTSTRAP: $* ==="; }

# ── optional verification ────────────────────────────────────────────────────
# This host has no SSH path by design, so a verification script cannot simply be
# copied over and run. It is fetched from INSTANCE METADATA instead and executed
# with the token already in hand, writing its results to the serial console — the
# same channel everything else here reports on.
#
# Set the metadata key `run-verify=1` and reboot to trigger it. Absent, nothing
# happens, so a normal boot is unaffected.
maybe_verify() {
  local flag script
  flag=$(curl -s -H "Metadata-Flavor: Google"     "http://metadata.google.internal/computeMetadata/v1/instance/attributes/run-verify" 2>/dev/null || echo "")
  [ "$flag" = "1" ] || return 0

  script=$(curl -s -H "Metadata-Flavor: Google"     "http://metadata.google.internal/computeMetadata/v1/instance/attributes/verify-script" 2>/dev/null || echo "")
  if [ -z "$script" ]; then say "run-verify=1 but no verify-script in metadata"; return 0; fi

  say "running verification"
  printf '%s' "$script" > /opt/judge0-verify.sh
  chmod +x /opt/judge0-verify.sh
  JUDGE0_TOKEN="$1" JUDGE0_URL="http://localhost:2358" bash /opt/judge0-verify.sh 2>&1     | while IFS= read -r l; do say "VERIFY | $l"; done
}

# ── phase 1 ──────────────────────────────────────────────────────────────────
if [ ! -f "$MARK/phase1" ]; then
  say "phase 1 starting (cgroup v1 + docker)"

  # A DROP-IN, not an edit to /etc/default/grub.
  #
  # This is what caught the first attempt out. GCP's Ubuntu cloud images set
  # GRUB_CMDLINE_LINUX_DEFAULT from /etc/default/grub.d/50-cloudimg-settings.cfg,
  # which is sourced AFTER /etc/default/grub and therefore overwrites anything
  # edited there. The edit applied cleanly, update-grub ran, the machine rebooted
  # — and came up on cgroup v2 with no error anywhere. Only the explicit
  # /sys/fs/cgroup/cpuacct check in phase 2 caught it.
  #
  # A 99- drop-in is sourced last and APPENDS to whatever the image set, so the
  # image's own kernel settings are preserved rather than fought.
  say "installing the cgroup v1 GRUB drop-in"
  cat > /etc/default/grub.d/99-judge0-cgroup.cfg <<'GRUBEOF'
GRUB_CMDLINE_LINUX_DEFAULT="$GRUB_CMDLINE_LINUX_DEFAULT systemd.unified_cgroup_hierarchy=0 systemd.legacy_systemd_cgroup_controller=1"
GRUBEOF
  update-grub
  say "kernel cmdline BEFORE reboot: $(cat /proc/cmdline)"

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y docker.io docker-compose unzip curl python3
  systemctl enable --now docker

  touch "$MARK/phase1"
  say "phase 1 done — rebooting into cgroup v1"
  # `--no-block` so systemd does not wait on this very unit before rebooting.
  systemctl --no-block reboot
  exit 0
fi

# ── phase 2 ──────────────────────────────────────────────────────────────────
if [ -f "$MARK/phase2" ]; then
  say "already provisioned; ensuring Judge0 is up"
  cd "/opt/judge0-v${JUDGE0_VERSION}" && docker-compose up -d
  TOKEN_FOR_VERIFY=$(grep -E '^AUTHN_TOKEN=' judge0.conf | cut -d= -f2-)
  # Give a just-restarted stack a moment before asking it anything.
  sleep 25
  maybe_verify "$TOKEN_FOR_VERIFY"
  say "JUDGE0_BOOTSTRAP_COMPLETE"
  exit 0
fi

say "phase 2 starting (Judge0 ${JUDGE0_VERSION})"

# Confirm the reboot actually took. If cgroup v2 is still mounted, isolate will
# fail in ways that look like every submission erroring, so fail loudly here
# instead of shipping a judge that cannot judge.
say "kernel cmdline AFTER reboot: $(cat /proc/cmdline)"
say "contents of /sys/fs/cgroup: $(echo $(ls /sys/fs/cgroup))"
if [ ! -d /sys/fs/cgroup/cpuacct ]; then
  say "FATAL: cgroup v1 is not active (no /sys/fs/cgroup/cpuacct). Not starting Judge0."
  exit 1
fi
say "cgroup v1 confirmed active"

cd /opt
if [ ! -d "judge0-v${JUDGE0_VERSION}" ]; then
  say "downloading Judge0 ${JUDGE0_VERSION}"
  curl -fsSL -o judge0.zip \
    "https://github.com/judge0/judge0/releases/download/v${JUDGE0_VERSION}/judge0-v${JUDGE0_VERSION}.zip"
  unzip -o -q judge0.zip
fi
cd "judge0-v${JUDGE0_VERSION}"

say "reading the auth token from Secret Manager"
ACCESS_TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
AUTHN_TOKEN=$(curl -s -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT_NUMBER}/secrets/${SECRET_NAME}/versions/latest:access" \
  | python3 -c 'import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())')
if [ -z "${AUTHN_TOKEN}" ]; then
  say "FATAL: could not read the auth token. Refusing to start an unauthenticated judge."
  exit 1
fi
say "auth token retrieved (${#AUTHN_TOKEN} chars)"

# PERSISTED, not regenerated. This was a real bug: a fresh password on every run
# while the Postgres DATA VOLUME survives means the server authenticates with a
# credential the database no longer has, and crash-loops forever. Generated once,
# reused on every subsequent boot.
if [ ! -f "$MARK/pg.pw" ]; then openssl rand -hex 24 > "$MARK/pg.pw"; chmod 600 "$MARK/pg.pw"; fi
if [ ! -f "$MARK/redis.pw" ]; then openssl rand -hex 24 > "$MARK/redis.pw"; chmod 600 "$MARK/redis.pw"; fi
PG_PASSWORD=$(cat "$MARK/pg.pw")
REDIS_PASSWORD=$(cat "$MARK/redis.pw")

# A clean slate for a phase-2 that has not yet succeeded. Judge0's own database
# holds only ITS submission records — ours live in Firestore — so wiping it costs
# nothing and removes any volume left inconsistent by an earlier failed attempt.
say "clearing any previous Judge0 state"
docker-compose down -v --remove-orphans 2>/dev/null || true

# Set keys idempotently rather than appending: docker-compose's env_file
# de-duplicates unpredictably, so a second AUTHN_TOKEN= line is a coin flip.
say "writing judge0.conf"
python3 - "$AUTHN_TOKEN" "$PG_PASSWORD" "$REDIS_PASSWORD" <<'PYEOF'
import sys, re, io
authn, pgpw, rdpw = sys.argv[1], sys.argv[2], sys.argv[3]
settings = {
    # Authentication. Ships EMPTY, i.e. disabled.
    "AUTHN_TOKEN": authn,
    # The caller must NOT be able to grant a submission network access.
    "ALLOW_ENABLE_NETWORK": "false",
    # Bounds on one submission, matching the app's own authoring caps
    # (MAX_TIME_LIMIT_MS = 15000, MAX_MEMORY_MB = 512).
    "MAX_CPU_TIME_LIMIT": "15",
    "MAX_WALL_TIME_LIMIT": "35",
    "MAX_MEMORY_LIMIT": "524288",
    "MAX_PROCESSES_AND_OR_THREADS": "60",
    "MAX_MAX_FILE_SIZE": "4096",
    # Output caps: a program that prints in a loop until the time limit should not
    # be able to fill the host's disk or the API's response.
    "MAX_STACK_LIMIT": "128000",
    "MAX_NUMBER_OF_RUNS": "20",
    # Datastore credentials — required, and blank by default.
    "POSTGRES_PASSWORD": pgpw,
    "REDIS_PASSWORD": rdpw,
    # THE HOSTS, and this is what the crash loop turned out to be. Judge0's
    # shipped judge0.conf sets POSTGRES_HOST=localhost, which is correct for a
    # single-machine install and wrong for the docker-compose one it also ships:
    # inside the server container, `localhost` is the server, not the database. So
    # the server booted, failed to reach Postgres, exited, and was restarted every
    # ~100 seconds — with no error on the console, because the failure was inside a
    # container nobody was reading. `db` and `redis` are the compose service names.
    "POSTGRES_HOST": "db",
    "REDIS_HOST": "redis",
    # And the rest of the coordinates, which the shipped conf leaves EMPTY. An
    # empty POSTGRES_PORT reaches database.yml as "" rather than as unset, so the
    # `|| 5432` default never fires and the connection is made to no port at all.
    # Set here and NOT in the compose override, because the `db` container reads
    # the same file to decide which user and database initdb creates: one source
    # for both sides of the connection is what keeps them agreeing.
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "judge0",
    "POSTGRES_USER": "judge0",
    "REDIS_PORT": "6379",
}
path = "judge0.conf"
text = open(path).read()
for key, value in settings.items():
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    if pattern.search(text):
        text = pattern.sub(f"{key}={value}", text, count=1)
    else:
        text += f"\n{key}={value}\n"
open(path, "w").write(text)
print(f"set {len(settings)} keys")
PYEOF
# THE CRASH LOOP ENDED HERE, and the cause was this script.
#
# judge0.conf is BIND-MOUNTED into the container, so the host file's mode is what
# the container sees — and Judge0 runs as a NON-ROOT user. `chmod 600` (which this
# line used to be, as hardening) meant `scripts/load-config` could not read it:
#
#   server_1 | ./scripts/load-config: line 11: /judge0.conf: Permission denied
#
# so the server exited on every boot, the workers came up with no Redis password
# ("NOAUTH Authentication required"), and the container env carried none of the
# settings written above. Four boots were spent reading that as a wrong VALUE in
# the conf when the conf was never read at all.
#
# The file holds the API token and both datastore passwords, and the untrusted
# principal on this host is candidate code in an isolate sandbox — so it is NOT
# made world-readable. It is handed to the one uid that needs it: the image's own
# user, read from the image rather than assumed. A judge that will not start is a
# worse outcome than a 644 file, so an unreadable uid falls back rather than fails.
CONTAINER_UID=$(docker run --rm --entrypoint id "judge0/judge0:${JUDGE0_VERSION}" -u 2>/dev/null || echo "")
case "$CONTAINER_UID" in
  ''|*[!0-9]*)
    chmod 644 judge0.conf
    say "could not read the image uid; judge0.conf left world-readable so the judge starts"
    ;;
  *)
    chown "$CONTAINER_UID" judge0.conf
    chmod 600 judge0.conf
    say "judge0.conf owned by uid ${CONTAINER_UID} (the image user), mode 600"
    ;;
esac

# What judge0.conf ACTUALLY ends up saying about the two hosts. The crash loop
# survived a fix to these keys, so the question "did the setting land" has to be
# answerable from the console rather than assumed. Passwords are never printed.
grep -nE "^(POSTGRES_HOST|REDIS_HOST|POSTGRES_PORT|REDIS_PORT)=" judge0.conf | while read -r l; do say "conf: $l"; done
say "duplicate host keys: POSTGRES_HOST=$(grep -cE '^POSTGRES_HOST=' judge0.conf) REDIS_HOST=$(grep -cE '^REDIS_HOST=' judge0.conf)"

# A floor under the conf, not an authority over it: load-config sources the conf
# after the environment is set, so these lose to it whenever it loads. They are here
# so that `docker inspect` states the intended hosts, and so a conf that fails to
# load leaves the containers pointed somewhere real rather than at localhost.
say "writing docker-compose.override.yml to pin the datastore hosts"
# docker-compose v1 refuses an override whose `version` differs from the base
# file's, so the base file's own line is copied rather than guessed.
VER_LINE=$(grep -m1 -E "^version:" docker-compose.yml || true)
{
  [ -n "$VER_LINE" ] && echo "$VER_LINE"
  cat <<'OVERRIDE'
services:
  server:
    environment:
      POSTGRES_HOST: db
      REDIS_HOST: redis
  workers:
    environment:
      POSTGRES_HOST: db
      REDIS_HOST: redis
OVERRIDE
} > docker-compose.override.yml
say "override written; base version line: ${VER_LINE:-none}"

say "starting datastores"
docker-compose up -d db redis
sleep 20
say "starting Judge0 server and workers"
docker-compose up -d
sleep 20

# 15 minutes, not 5. Judge0's FIRST boot runs Rails migrations and seeds 71
# languages into a freshly initialised Postgres, and on a 2-vCPU box that is
# minutes rather than seconds. A five-minute window diagnosed a slow migration as
# a dead judge — which sent me looking for a crash that may not exist.
# The window is metadata-tunable (`wait-iterations`, 5s each) so a diagnostic
# cycle does not have to sit through fifteen minutes to reach the dump.
WAIT_ITERS=$(curl -s -H "Metadata-Flavor: Google"   "http://metadata.google.internal/computeMetadata/v1/instance/attributes/wait-iterations" 2>/dev/null || echo "")
case "$WAIT_ITERS" in ''|*[!0-9]*) WAIT_ITERS=180 ;; esac
say "waiting for the API to answer (up to $((WAIT_ITERS * 5))s; first boot migrates and seeds)"
for i in $(seq 1 "$WAIT_ITERS"); do
  if curl -fsS -m 5 "http://localhost:2358/system_info" -H "X-Auth-Token: ${AUTHN_TOKEN}" >/dev/null 2>&1; then
    say "API is answering after ~$((i * 5))s"
    break
  fi
  # A heartbeat every minute, so a long wait is distinguishable from a hang.
  if [ $((i % 12)) -eq 0 ]; then
    say "still waiting ($((i * 5))s) — server container: $(docker inspect -f '{{.State.Status}} restarts={{.RestartCount}}' judge0-v1131_server_1 2>/dev/null || echo unknown)"
  fi
  sleep 5
done

# If the API never answered, the containers are the only place the reason lives —
# and this host has no SSH path, so the evidence has to reach the serial console.
if ! curl -fsS -m 5 "http://localhost:2358/system_info" -H "X-Auth-Token: ${AUTHN_TOKEN}" >/dev/null 2>&1; then
  say "API DID NOT ANSWER — dumping container state"
  say "--- docker ps -a ---"
  docker ps -a --format '{{.Names}} | {{.Status}} | {{.Image}}' 2>&1 | while read -r l; do say "  $l"; done
  for svc in server workers db redis; do
    # Ruby backtraces run ~65 frames, so an unfiltered tail throws away the one line
    # that matters: the exception message above them. Drop backtrace frames and the
    # env echo, then tail what is left.
    say "--- docker logs ${svc} (lines that look like a fault) ---"
    docker-compose logs --no-color --tail=600 "$svc" 2>&1 | grep -viE "[[:space:]]+from[[:space:]]+/|[|][[:space:]]*/(opt|api|usr)/|declare -x" | grep -iE "error|exception|fatal|could not|denied|refused|missing|exiting|invalid|unable|no such|not exist" | tail -20 | while read -r l; do say "  $l"; done
  done
  # Which values the server container actually resolves, after every layer has had
  # its say. Two boots were spent inferring this from error messages. Passwords are
  # masked; the question is only ever whether they are SET.
  say "--- server env (datastores) ---"
  docker inspect judge0-v1131_server_1 --format "{{range .Config.Env}}{{println .}}{{end}}" 2>/dev/null | grep -E "^(POSTGRES|REDIS)_" | sed -E "s/PASSWORD=.+/PASSWORD=<set>/" | while read -r l; do say "  $l"; done
  say "pg_isready: $(docker exec judge0-v1131_db_1 pg_isready -U judge0 -d judge0 2>&1 | tail -1)"
  say "JUDGE0_BOOTSTRAP: FATAL: judge did not come up; see the dump above"
  exit 1
fi

LANG_COUNT=$(curl -fsS -m 10 "http://localhost:2358/languages" -H "X-Auth-Token: ${AUTHN_TOKEN}" \
  | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
say "languages reported by this judge: ${LANG_COUNT}"

# Prove authentication is actually ON. An unauthenticated 200 here means the whole
# host is a public remote-code-execution endpoint, so it is worth one request.
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "http://localhost:2358/languages" || echo 000)
say "unauthenticated request returns HTTP ${UNAUTH} (expect 401 or 403)"

touch "$MARK/phase2"
maybe_verify "$AUTHN_TOKEN"
say "JUDGE0_BOOTSTRAP_COMPLETE languages=${LANG_COUNT} unauth=${UNAUTH}"
