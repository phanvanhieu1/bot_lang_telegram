#!/usr/bin/env bash
# Deploy telegram-lang-bot on Cloudfly VPS (Ubuntu + PM2 + Doppler).
# Run as the Linux user 'dev', never with sudo.
set -Eeuo pipefail

APP_DIR="/home/dev/projects/bot_lang_telegram"
WEB_NAME="translator-web"
BOT_NAME="telegram-lang-bot"
PM2_SERVICE="pm2-dev"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-}"  # Optional: a real HTTP health endpoint.
CHECK_ONLY=false

usage() {
  cat <<'USAGE'
Usage: ./deploy.sh [--check]
  --check   Verify prerequisites without pulling code, installing packages, or restarting.

Optional health check:
  WEB_HEALTH_URL=http://127.0.0.1:PORT/health ./deploy.sh

Run as user 'dev' on the Cloudfly VPS. Never use sudo with this script.
USAGE
}

case "${1:-}" in
  "") ;;
  --check) CHECK_ONLY=true ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
if (( $# > 1 )); then usage >&2; exit 2; fi

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

on_exit() {
  local rc=$?
  if (( rc != 0 )); then
    printf '\n[ERROR] Deploy stopped (exit code %s).\n' "$rc" >&2
    printf '[ERROR] Do not reboot. Inspect: pm2 list; pm2 logs translator-web --lines 50 --nostream\n' >&2
    printf '[ERROR] And: pm2 logs telegram-lang-bot --lines 50 --nostream\n' >&2
    if [[ -n "${OLD_REV:-}" ]]; then
      printf '[INFO] Previous Git commit: %s (not rolled back automatically).\n' "$OLD_REV" >&2
    fi
  fi
}
trap on_exit EXIT

[[ "$(id -un)" == "dev" ]] || fail "Run as user 'dev' (not root/sudo)."
[[ -d "$APP_DIR" ]] || fail "Project directory not found: $APP_DIR"
for cmd in git npm node pm2 doppler flock systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
done

# A dedicated lock prevents two overlapping deployments.
exec 9>"$HOME/.telegram-lang-deploy.lock"
flock -n 9 || fail "Another deployment is already running."

cd "$APP_DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Not a Git repository."
git symbolic-ref -q --short HEAD >/dev/null || fail "Detached HEAD; select a branch first."
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1 \
  || fail "Current branch has no upstream. Configure it before deploying."

# Fail rather than overwriting edits made directly on the VPS.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  git status --short >&2
  fail "Tracked files have local changes. Commit or resolve them on your Mac; don't deploy over them."
fi

if git ls-files --error-unmatch -- .env >/dev/null 2>&1; then
  fail "The project .env is tracked by Git. Remove it from the repository before deploying."
fi

[[ ! -e "$APP_DIR/.env" ]] || fail "A project .env file exists; remove it only after confirming Doppler is configured."

systemctl is-active --quiet "$PM2_SERVICE" \
  || fail "Systemd service $PM2_SERVICE is not active."

# Verify that these names still point at the Doppler wrapper scripts.
# Do not display PM2 environment variables: they may contain secrets.
check_pm2() {
  local name="$1" expected_script="$2" result
  result="$(pm2 jlist | PM2_EXPECTED_NAME="$name" PM2_EXPECTED_SCRIPT="$expected_script" node -e '
      let input = "";
      process.stdin.on("data", c => input += c);
      process.stdin.on("end", () => {
        let list;
        try { list = JSON.parse(input); } catch { process.exit(2); }
        const p = list.find(x => x.name === process.env.PM2_EXPECTED_NAME);
        if (!p || p.pm2_env?.pm_exec_path !== process.env.PM2_EXPECTED_SCRIPT ||
            p.pm2_env?.status !== "online" || !(p.pid > 0)) process.exit(1);
        process.stdout.write(String(p.pid));
      });
    ')" || return 1
  [[ -n "$result" ]] || return 1
  printf '%s' "$result"
}

WEB_SCRIPT="$APP_DIR/bin/start-web.sh"
BOT_SCRIPT="$APP_DIR/bin/start-bot.sh"
[[ -f "$WEB_SCRIPT" && -f "$BOT_SCRIPT" ]] \
  || fail "Missing bin/start-web.sh or bin/start-bot.sh."
check_pm2 "$WEB_NAME" "$WEB_SCRIPT" >/dev/null \
  || fail "PM2 $WEB_NAME is not online via $WEB_SCRIPT."
check_pm2 "$BOT_NAME" "$BOT_SCRIPT" >/dev/null \
  || fail "PM2 $BOT_NAME is not online via $BOT_SCRIPT."

# Check live Doppler config without printing any secret values.
log "Checking Doppler production credentials..."
doppler run --fallback-readonly -- node -e '
  if (process.env.DOPPLER_CONFIG !== "prd") {
    console.error("Wrong Doppler config; expected prd."); process.exit(1);
  }
  if (process.env.NODE_ENV !== "production") {
    console.error("NODE_ENV must be production in Doppler prd."); process.exit(1);
  }
' || fail "Cannot validate Doppler prd / NODE_ENV."

OLD_REV="$(git rev-parse --short HEAD)"
log "Current commit: $OLD_REV"

if "$CHECK_ONLY"; then
  log "Preflight OK. No code changes or restarts were made."
  exit 0
fi

[[ -f package-lock.json || -f npm-shrinkwrap.json ]] \
  || fail "Missing package-lock.json / npm-shrinkwrap.json; npm ci requires a lockfile."

log "Pulling code (fast-forward only)..."
git pull --ff-only

# A change in the upstream commit can affect deploy scripts/requirements.
[[ -f package-lock.json || -f npm-shrinkwrap.json ]] \
  || fail "The updated commit has no npm lockfile."
[[ -f "$WEB_SCRIPT" && -f "$BOT_SCRIPT" ]] \
  || fail "Doppler startup scripts are missing after git pull."
[[ ! -e "$APP_DIR/.env" ]] || fail "The updated checkout unexpectedly contains .env."

log "Installing production dependencies..."
npm ci --omit=dev

# Brief stability check: confirm PM2 still has the same live PID after a delay.
restart_and_check() {
  local name="$1" script="$2" pid_a pid_b
  log "Restarting $name..."
  pm2 restart "$name" >/dev/null
  sleep 3
  pid_a="$(check_pm2 "$name" "$script")" \
    || fail "$name is not online or is not using the expected Doppler script."
  sleep 3
  pid_b="$(check_pm2 "$name" "$script")" \
    || fail "$name stopped shortly after restart."
  [[ "$pid_a" == "$pid_b" ]] || fail "$name restarted unexpectedly during the stability check."
  log "$name online (PID $pid_b)."
}

restart_and_check "$WEB_NAME" "$WEB_SCRIPT"

if [[ -n "$WEB_HEALTH_URL" ]]; then
  command -v curl >/dev/null 2>&1 || fail "curl required for WEB_HEALTH_URL."
  log "Checking the configured web health endpoint..."
  healthy=false
  for attempt in 1 2 3 4 5; do
    if curl --fail --silent --show-error --output /dev/null \
      --connect-timeout 3 --max-time 8 "$WEB_HEALTH_URL"; then
      healthy=true
      break
    fi
    sleep 2
  done
  "$healthy" || fail "Web health check did not pass: $WEB_HEALTH_URL"
else
  log "WEB_HEALTH_URL not set: only PM2 process health is checked."
fi

restart_and_check "$BOT_NAME" "$BOT_SCRIPT"

NEW_REV="$(git rev-parse --short HEAD)"
log "Deployment complete: $OLD_REV -> $NEW_REV"
log "IMPORTANT: Test a real translation on the website and a Telegram bot reply."
log "No secrets were printed and no .env file was created by this script."
