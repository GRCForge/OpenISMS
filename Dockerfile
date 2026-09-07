# syntax=docker/dockerfile:1
# Kombiniertes Single-Container-Image: Express-Backend liefert das gebaute
# React-Frontend gleich mit aus. Build-Context = Repo-Root.
#   docker build -t isms:latest .

# --- Stage 1: Frontend bauen ---
FROM node:26.8.1-alpine AS frontend-build
RUN apk add --no-cache git && npm install -g npm@11 --loglevel=error
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY scripts/ /scripts/
COPY VERSION /VERSION
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Backend + statisches Frontend ---
FROM node:26.8.1-alpine
# OS-Pakete auf den Stand der Alpine-Repos heben, bevor irgendetwas anderes
# passiert. Das Base-Image wird nur bei jedem Node-Release neu gebaut; CVEs, die
# danach in Alpine gepatcht werden, sitzen bis dahin im Image fest. Konkreter
# Anlass: Aikido meldete am 05.09.2026 zehn openssl-CVEs (3.5.7-r0, davon
# CVE-2026-63073 und CVE-2026-75803 als kritisch, Memory Corruption bis RCE),
# Zielversion 3.5.8-r0. Ein reiner Tag-Bump haette das nur zufaellig behoben,
# je nachdem wann das Base-Image zuletzt gebaut wurde.
#
# Bewusster Kompromiss: Zwei Builds desselben Commits koennen dadurch
# unterschiedliche OS-Paketstaende enthalten, das Image ist also nicht mehr
# bit-reproduzierbar. Ein Image mit bekannter RCE auszuliefern waere schlechter
# als diese Einbusse; die ausgelieferte Fassung ist ueber das Versions-Tag
# (ghcr.io/...-app:vX.Y.Z, siehe .github/workflows/release.yml) weiterhin
# eindeutig identifizierbar.
RUN apk --no-cache upgrade
# No git needed at runtime (no git-sourced deps in package-lock.json) — keeping it
# out shrinks the image and its attack surface.
RUN npm install -g npm@11 --loglevel=error
WORKDIR /app
ENV NODE_ENV=production
# libuv threadpool default is 4; bcrypt, file SHA-256 hashing, zip/backup I/O and
# pdf/docx parsing all use it — 8 reduces head-of-line blocking under concurrent load.
ENV UV_THREADPOOL_SIZE=8
COPY backend/package.json backend/package-lock.json ./
# --loglevel=error suppresses the dottie deprecation warning (transitive dep of
# sequelize@6; dottie@2.0.7 is the latest version — no fix available upstream).
RUN npm ci --omit=dev --loglevel=error || npm install --omit=dev --loglevel=error
COPY backend/ ./
# Gebautes Frontend wird von Express aus /app/public ausgeliefert (siehe src/index.js)
COPY --from=frontend-build /frontend/dist ./public
# Versionsdatei fuer /api/version
COPY VERSION ./VERSION
RUN mkdir -p /app/uploads
RUN chown -R 1000:1000 /app
USER 1000
EXPOSE 3001
CMD ["node", "src/index.js"]
