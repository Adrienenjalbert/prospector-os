#!/usr/bin/env bash
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✔${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✖ $1${NC}"; exit 1; }

# ── 1. Check required tools ──────────────────────────────────────────────────
info "Checking required tools…"

command -v node  >/dev/null 2>&1 || fail "node is not installed. Install Node.js 20+."
command -v npm   >/dev/null 2>&1 || fail "npm is not installed."
command -v docker >/dev/null 2>&1 || fail "docker is not installed."

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js 20+ is required (found v$(node -v))."
fi

ok "node $(node -v), npm $(npm -v), docker $(docker --version | cut -d' ' -f3)"

# ── 2. Create .env.local for web app ──────────────────────────────────────────
if [ ! -f apps/web/.env.local ]; then
  info "Creating apps/web/.env.local from .env.example…"
  cp .env.example apps/web/.env.local
  ok "Created apps/web/.env.local"
else
  warn "apps/web/.env.local already exists — skipping copy."
fi

if [ ! -f .env.local ]; then
  info "Symlinking root .env.local → apps/web/.env.local…"
  ln -s apps/web/.env.local .env.local 2>/dev/null || cp apps/web/.env.local .env.local
  ok "Root .env.local linked."
fi

# ── 3. Prompt for required API keys ──────────────────────────────────────────
echo ""
info "Configure API keys (press Enter to keep existing value):"
echo ""

prompt_key() {
  local var_name="$1"
  local description="$2"
  local current
  current=$(grep "^${var_name}=" apps/web/.env.local 2>/dev/null | cut -d= -f2- || echo "")

  read -rp "  ${description} [${current:-(not set)}]: " value
  if [ -n "$value" ]; then
    if grep -q "^${var_name}=" apps/web/.env.local 2>/dev/null; then
      sed -i.bak "s|^${var_name}=.*|${var_name}=${value}|" apps/web/.env.local
    else
      echo "${var_name}=${value}" >> apps/web/.env.local
    fi
  fi
}

prompt_key "ANTHROPIC_API_KEY"        "Anthropic API key"
prompt_key "OPENAI_API_KEY"           "OpenAI API key (embeddings)"
prompt_key "HUBSPOT_PRIVATE_APP_TOKEN" "HubSpot private app token"
prompt_key "SLACK_BOT_TOKEN"          "Slack bot token"
prompt_key "SLACK_SIGNING_SECRET"     "Slack signing secret"
prompt_key "APOLLO_API_KEY"           "Apollo API key"

# Clean up sed backups
rm -f apps/web/.env.local.bak

echo ""
ok "API keys configured."

# ── 4. Start the database ────────────────────────────────────────────────────
info "Starting database with Docker Compose…"
docker compose up -d db
ok "Database container started."

# ── 5. Wait for database to be ready ─────────────────────────────────────────
info "Waiting for database to accept connections…"
RETRIES=30
until docker compose exec -T db pg_isready -U postgres -d revenue_ai_os >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    fail "Database did not become ready in time."
  fi
  sleep 1
done
ok "Database is ready."

# ── 6. Install dependencies ──────────────────────────────────────────────────
info "Installing npm dependencies…"
npm install
ok "Dependencies installed."

# ── 7. Run seed scripts ──────────────────────────────────────────────────────
info "Running seed scripts…"
npx tsx scripts/seed.ts
npx tsx scripts/seed-tools.ts
ok "Database seeded."

# ── 8. Start the dev server ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Revenue AI OS is ready!${NC}"
echo -e "${GREEN}  Starting dev server at http://localhost:3000${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo ""

npm run dev
