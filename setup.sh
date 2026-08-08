#!/bin/bash
# ═══════════════════════════════════════════════════════
#  setup.sh — Bot Setup & Launch Script
#  Usage: bash setup.sh
# ═══════════════════════════════════════════════════════

set -e  # يوقف عند أي خطأ

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[⚠]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo -e "${CYAN}        Bot Setup & Deploy Script       ${NC}"
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo ""

# ── 1. Check Node.js ─────────────────────────────────
info "Checking Node.js..."
if ! command -v node &> /dev/null; then
  err "Node.js not found. Install from https://nodejs.org"
fi
NODE_VER=$(node -v)
log "Node.js $NODE_VER found"

# ── 2. Check npm ─────────────────────────────────────
if ! command -v npm &> /dev/null; then
  err "npm not found"
fi
log "npm $(npm -v) found"

# ── 3. Check .env ─────────────────────────────────────
info "Checking .env file..."
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    warn ".env not found — copied from .env.example"
    warn "Edit .env and set BOT_TOKEN and ADMIN_IDS before continuing"
    echo ""
    read -p "Press Enter after editing .env to continue..."
  else
    err ".env not found and no .env.example available"
  fi
fi

# Validate required vars in .env
BOT_TOKEN=$(grep -E "^BOT_TOKEN=" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
ADMIN_IDS=$(grep -E "^ADMIN_IDS=" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'")

if [ -z "$BOT_TOKEN" ] || [ "$BOT_TOKEN" = "YOUR_BOT_TOKEN_HERE" ]; then
  err "BOT_TOKEN is not set in .env — set it and rerun"
fi
if [ -z "$ADMIN_IDS" ] || [ "$ADMIN_IDS" = "YOUR_TELEGRAM_ID_HERE" ]; then
  err "ADMIN_IDS is not set in .env — set it and rerun"
fi
log ".env validated (BOT_TOKEN and ADMIN_IDS present)"

# ── 4. Install dependencies ───────────────────────────
info "Installing npm dependencies..."
npm install --omit=dev
log "Dependencies installed"

# ── 5. Create data directories ────────────────────────
info "Creating data directories..."
mkdir -p data/tasks data/backups exports
log "Directories ready: data/, data/tasks/, data/backups/, exports/"

# ── 6. Check PM2 ─────────────────────────────────────
info "Checking PM2..."
if ! command -v pm2 &> /dev/null; then
  warn "PM2 not found — installing globally..."
  npm install -g pm2
  log "PM2 installed"
else
  log "PM2 $(pm2 -v) found"
fi

# ── 7. Create PM2 ecosystem config if not exists ─────
if [ ! -f "ecosystem.config.js" ]; then
  info "Creating ecosystem.config.js..."
  cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name:               'task-bot',
    script:             'src/index.js',
    instances:          1,
    autorestart:        true,
    watch:              false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
    error_file:  'logs/err.log',
    out_file:    'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
EOF
  mkdir -p logs
  log "ecosystem.config.js created"
else
  log "ecosystem.config.js already exists"
fi

# ── 8. Stop existing instance if running ─────────────
info "Checking for existing bot process..."
if pm2 list | grep -q "task-bot"; then
  warn "Stopping existing task-bot process..."
  pm2 stop task-bot || true
  pm2 delete task-bot || true
  log "Old process stopped"
fi

# ── 9. Start bot with PM2 ────────────────────────────
info "Starting bot with PM2..."
pm2 start ecosystem.config.js
pm2 save
log "Bot started and saved to PM2 startup"

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}     ✅  Bot is running successfully!   ${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
info "Useful commands:"
echo "   pm2 logs task-bot        — view live logs"
echo "   pm2 status               — check status"
echo "   pm2 restart task-bot     — restart bot"
echo "   pm2 stop task-bot        — stop bot"
echo ""

# ── 10. Show live logs ───────────────────────────────
read -p "Show live logs now? (y/n): " SHOW_LOGS
if [[ "$SHOW_LOGS" =~ ^[Yy]$ ]]; then
  pm2 logs task-bot
fi
