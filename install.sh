#!/usr/bin/env bash
# OpenISMS Installation Script
# Supports: Docker Compose (default) and bare-metal systemd deployment
set -euo pipefail

###############################################################################
# Variables
###############################################################################
INSTALL_DIR="${INSTALL_DIR:-/opt/isms}"
SERVICE_USER="${SERVICE_USER:-isms}"
NODE_VERSION="26"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
need_root() { [[ $EUID -eq 0 ]] || error "Please run as root (sudo $0)"; }

###############################################################################
# Helpers
###############################################################################
check_docker() {
  command -v docker &>/dev/null || error "Docker not found. Install it first: https://docs.docker.com/get-docker/"
  docker compose version &>/dev/null || error "Docker Compose v2 not found. Update Docker or install the plugin."
}

check_node() {
  if ! command -v node &>/dev/null; then
    warn "Node.js not found. Installing via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
  fi
  NODE_MAJOR=$(node -e "process.stdout.write(process.version.split('.')[0].slice(1))")
  [[ "$NODE_MAJOR" -ge 26 ]] || error "Node.js 26+ required (found $(node -v))"
  info "Node.js $(node -v) detected"
}

# Interactive Node.js version check for updates
check_node_interactive() {
  if ! command -v node &>/dev/null; then
    warn "Node.js not found. Installing via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
    info "Node.js installed successfully."
    return 0
  fi
  
  NODE_MAJOR=$(node -e "process.stdout.write(process.version.split('.')[0].slice(1))")
  
  if [[ "$NODE_MAJOR" -ge 26 ]]; then
    info "Node.js $(node -v) is compatible"
    return 0
  fi
  
  warn "Node.js version is outdated: $(node -v)"
  warn "OpenISMS requires Node.js 26 or later"
  echo ""
  read -rp "Update Node.js to version ${NODE_VERSION}? [y/N]: " UPDATE_NODE
  UPDATE_NODE="${UPDATE_NODE:-n}"
  
  if [[ "$UPDATE_NODE" =~ ^[Yy]$ ]]; then
    info "Updating Node.js via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y nodejs
    info "Node.js updated successfully to $(node -v)"
    return 0
  else
    warn "Skipping Node.js update. Some features may not work correctly."
    warn "Please update Node.js manually before running npm commands."
    return 1
  fi
}

# Generate a 64-char hex secret (openssl preferred, /dev/urandom fallback).
gen_secret() {
  if command -v openssl &>/dev/null; then
    openssl rand -hex 32
  else
    LC_ALL=C tr -dc 'a-f0-9' < /dev/urandom | head -c 64
  fi
}

# Ensure a secret is present and strong in the .env file. Replaces empty,
# placeholder (your_*_here) or changeme* values with a freshly generated one.
# Without this the app's required secrets (no fallback since v1.8.1) would stay
# at the .env.example placeholders and boot with a known-weak value.
ensure_env_secret() {
  local key="$1" file="$2" cur
  cur=$(grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2-)
  case "$cur" in
    ''|your_*_here|changeme*)
      local val; val=$(gen_secret)
      if grep -qE "^${key}=" "$file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${val}|" "$file"
      else
        echo "${key}=${val}" >> "$file"
      fi
      info "Generated a strong random ${key}"
      ;;
    *) : ;;  # already customised — keep it
  esac
}

# Populate all required app secrets in the given .env file.
ensure_env_secrets() {
  local file="$1"
  ensure_env_secret JWT_SECRET "$file"
  ensure_env_secret SESSION_SECRET "$file"
  ensure_env_secret ENCRYPTION_KEY "$file"
}

###############################################################################
# Mode selection
###############################################################################
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       OpenISMS Installation Script           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Detection
IS_DOCKER=false
IS_SYSTEMD=false
if docker compose ps --format json | grep -q '"Project":"isms"'; then IS_DOCKER=true; fi
if systemctl is-active --quiet isms-backend || systemctl is-active --quiet openisms; then IS_SYSTEMD=true; fi

echo "Choose action:"
echo "  1) Docker Compose  (new install / restart)"
echo "  2) Systemd service (new install / bare-metal)"
if $IS_DOCKER || $IS_SYSTEMD; then
  echo "  3) Update existing installation (Git Pull + Rebuild)"
fi
echo ""
read -rp "Action [1/2/3]: " MODE
MODE="${MODE:-1}"

###############################################################################
# Mode 3: Update
###############################################################################
if [[ "$MODE" == "3" ]]; then
  need_root
  info "Starting update process..."
  
  # 1. Pull latest code
  if [[ -d .git ]]; then
    info "Pulling latest changes from Git..."
    git pull
  else
    warn "Not a git repository. Skipping git pull."
  fi

  # 2. Update based on detected mode
  if $IS_DOCKER; then
    info "Updating Docker deployment..."
    docker compose up -d --build
    info "Docker update complete."
  elif $IS_SYSTEMD; then
    info "Updating Systemd deployment..."
    
    # Check Node.js version (interactive for updates)
    check_node_interactive
    
    # Sync files to install dir if we are running from a staging area BEFORE building
    if [[ "$(pwd)" != "$INSTALL_DIR" ]]; then
       cp -r backend "$INSTALL_DIR/"
       cp -r frontend "$INSTALL_DIR/"
       cp VERSION "$INSTALL_DIR/"
       chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    fi

    # Build backend
    info "Updating backend..."
    cd "$INSTALL_DIR/backend" && npm ci --omit=dev
    cd -

    # Build frontend
    info "Updating frontend..."
    cd "$INSTALL_DIR/frontend"
    npm ci
    npm run build
    cd -

    if systemctl is-active --quiet openisms; then
      systemctl restart openisms
    else
      systemctl restart isms-backend
    fi

    # Patch nginx config — two independent fixes, both non-destructive:
    #  1. Replace old directory-based /assets/ block with extension-regex (v2.1.0)
    #  2. Add /mcp location block if missing (v2.1.0 — MCP server)
    NGINX_CONF="/etc/nginx/sites-available/isms"
    NGINX_PATCHED=false
    if [[ -f "$NGINX_CONF" ]]; then
      python3 - "$NGINX_CONF" <<'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

changed = False

# Fix 1: replace old /assets/ directory block with file-extension regex
old_assets = r'location\s+/assets/\s*\{[^}]*\}'
new_assets = (
    'location ~* \\.(js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|map|gz|br)$ {\n'
    '        try_files $uri =404;\n'
    '        expires 1y;\n'
    '        add_header Cache-Control "public, immutable";\n'
    '    }'
)
patched, n = re.subn(old_assets, new_assets, content, flags=re.DOTALL)
if n:
    content = patched
    changed = True
    print(f"  [1] Replaced /assets/ location block with extension-regex.")

# Fix 2: add /mcp proxy block before the closing brace if missing
if 'location /mcp' not in content:
    mcp_block = (
        '\n'
        '    # MCP Server (Model Context Protocol) — HTTP/SSE transport\n'
        '    location /mcp {\n'
        '        proxy_pass http://127.0.0.1:3001;\n'
        '        proxy_http_version 1.1;\n'
        '        proxy_set_header Host $host;\n'
        '        proxy_set_header X-Real-IP $remote_addr;\n'
        '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
        '        proxy_set_header X-Forwarded-Proto $scheme;\n'
        '        proxy_set_header Connection \'\';\n'
        '        proxy_buffering off;\n'
        '        proxy_cache off;\n'
        '        proxy_read_timeout 24h;\n'
        '        chunked_transfer_encoding on;\n'
        '        client_max_body_size 1M;\n'
        '    }\n'
    )
    # Insert before the last closing brace of the server block
    content = re.sub(r'\}\s*$', mcp_block + '}', content, count=1)
    changed = True
    print("  [2] Added /mcp proxy location block.")

if changed:
    with open(path, 'w') as f:
        f.write(content)
else:
    print("  Nothing to patch (already up-to-date).")
PYEOF
      nginx -t && systemctl reload nginx
      NGINX_PATCHED=true
    fi
    if [[ "$NGINX_PATCHED" != "true" ]]; then
      systemctl restart nginx
    fi
    info "Systemd update complete."
  else
    error "Could not detect active installation to update."
  fi
  
  exit 0
fi

###############################################################################
# Mode 1: Docker Compose
###############################################################################
if [[ "$MODE" == "1" ]]; then
  need_root
  check_docker

  info "Deploying with Docker Compose..."

  # Copy env if needed
  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      cp .env.example .env
      warn ".env created from .env.example — edit it before production use!"
    else
      touch .env
    fi
  fi

  # Auto-generate strong secrets so the app doesn't boot with placeholders.
  ensure_env_secrets .env

  echo ""
  echo "Choose Docker setup:"
  echo "  1) Full Setup (App + MySQL) - Recommended for new deployments"
  echo "  2) Single Container (local build, requires external DB)"
  echo "  3) GHCR Pull (pre-built image from GitHub, requires external DB)"
  echo ""
  read -rp "Setup [1/2/3]: " DOCKER_SETUP
  DOCKER_SETUP="${DOCKER_SETUP:-1}"

  if [[ "$DOCKER_SETUP" == "1" ]]; then
    info "Starting full-stack deployment (building locally)..."
    docker compose up -d --build
  elif [[ "$DOCKER_SETUP" == "2" ]]; then
    # Single-container deployment requires an external MySQL database
    echo ""
    read -rp "DATABASE_URL (mysql://user:pass@host:3306/db): " DB_URL
    if grep -q "DATABASE_URL=" .env; then
      sed -i "s|DATABASE_URL=.*|DATABASE_URL=${DB_URL}|" .env
    else
      echo "DATABASE_URL=${DB_URL}" >> .env
    fi
    info "Starting single-container deployment (local build)..."
    docker compose -f docker-compose.single.yml up -d --build
  else
    # Pull pre-built image from GHCR — no local build required
    echo ""
    read -rp "DATABASE_URL (mysql://user:pass@host:3306/db): " DB_URL
    if grep -q "DATABASE_URL=" .env; then
      sed -i "s|DATABASE_URL=.*|DATABASE_URL=${DB_URL}|" .env
    else
      echo "DATABASE_URL=${DB_URL}" >> .env
    fi
    read -rp "ISMS version tag [latest]: " ISMS_VERSION
    ISMS_VERSION="${ISMS_VERSION:-latest}"
    export ISMS_VERSION
    info "Pulling ghcr.io/p3rf3ction/isms-app:${ISMS_VERSION} from GHCR..."
    docker compose -f docker-compose.ghcr.single.yml pull
    docker compose -f docker-compose.ghcr.single.yml up -d
  fi

  echo ""
  info "ISMS is starting up!"
  info "App (Frontend + API): http://localhost:8080"
  info "Default login: admin@isms.local / Admin1234!"
  echo ""
  exit 0
fi

###############################################################################
# Mode 2: Systemd (bare-metal)
###############################################################################
if [[ "$MODE" == "2" ]]; then
  need_root
  check_node

  # Check for nginx
  command -v nginx &>/dev/null || { apt-get update -qq && apt-get install -y nginx; }

  # Create service user
  if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    info "Created system user: $SERVICE_USER"
  fi

  # Create install directory
  mkdir -p "$INSTALL_DIR"
  cp -r backend "$INSTALL_DIR/"
  cp -r frontend "$INSTALL_DIR/"
  cp VERSION "$INSTALL_DIR/"
  [[ -f .env ]] && cp .env "$INSTALL_DIR/.env"
  [[ -f .env.example ]] && cp .env.example "$INSTALL_DIR/.env.example"

  # Build backend
  info "Installing backend dependencies..."
  cd "$INSTALL_DIR/backend" && npm ci --omit=dev
  cd -

  # Build frontend
  info "Building frontend..."
  cd "$INSTALL_DIR/frontend"
  npm ci
  npm run build
  cd -

  # Upload dir
  UPLOAD_DIR="${INSTALL_DIR}/uploads"
  mkdir -p "$UPLOAD_DIR"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$UPLOAD_DIR"

  # .env defaults
  ENV_FILE="$INSTALL_DIR/.env"
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$INSTALL_DIR/.env.example" "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"
    warn ".env not found — created at $ENV_FILE. Configure database settings before starting."
  fi

  # Auto-generate strong secrets so the service doesn't start with placeholders.
  ensure_env_secrets "$ENV_FILE"

  # Write systemd unit
  cat > /etc/systemd/system/openisms.service <<EOF
[Unit]
Description=OpenISMS Backend API
After=network.target mysql.service mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=UPLOAD_DIR=${UPLOAD_DIR}
ExecStart=$(command -v node) src/index.js
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openisms-backend

[Install]
WantedBy=multi-user.target
EOF

  # nginx config
  NGINX_CONF="/etc/nginx/sites-available/isms"
  cat > "$NGINX_CONF" <<'NGINXEOF'
server {
    listen 80;
    server_name _;

    root FRONTEND_DIST;
    index index.html;

    # Prevent caching of index.html
    location = /index.html {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";
    }

    # Vite static chunks and media — matched by extension, not by directory name.
    # Using a regex here (instead of "location /static/" or "location /assets/")
    # prevents nginx's directory-redirect behaviour from turning SPA routes like
    # /assets or /reports into 404s when a same-named physical directory exists.
    location ~* \.(js|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|ico|webp|map|gz|br)$ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA routing — everything else falls back to index.html
    location / {
        try_files $uri /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 30M;
    }

    # MCP Server (Model Context Protocol) — HTTP/SSE transport
    # proxy_buffering off is required so SSE events reach the client immediately.
    location /mcp {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
        chunked_transfer_encoding on;
        client_max_body_size 1M;
    }
}
NGINXEOF

  FRONTEND_DIST="$INSTALL_DIR/frontend/dist"
  sed -i "s|FRONTEND_DIST|${FRONTEND_DIST}|g" "$NGINX_CONF"

  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/isms 2>/dev/null || true
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

  # Enable & start
  systemctl daemon-reload
  systemctl enable openisms
  systemctl restart openisms
  nginx -t && systemctl enable nginx && systemctl restart nginx

  echo ""
  info "Installation complete!"
  info "Backend service: systemctl status openisms"
  info "Logs:            journalctl -u openisms -f"
  info "Frontend:        http://<server-ip>"
  info "Edit settings:   $ENV_FILE"
  warn "Don't forget to configure the database in $ENV_FILE!"
  echo ""
  exit 0
fi

error "Invalid mode: $MODE"
