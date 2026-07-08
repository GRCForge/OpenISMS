# syntax=docker/dockerfile:1
# Kombiniertes Single-Container-Image: Express-Backend liefert das gebaute
# React-Frontend gleich mit aus. Build-Context = Repo-Root.
#   docker build -t isms:latest .

# --- Stage 1: Frontend bauen ---
FROM node:26.3.0-alpine AS frontend-build
RUN apk add --no-cache git && npm install -g npm@11 --loglevel=error
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY scripts/ /scripts/
COPY VERSION /VERSION
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Backend + statisches Frontend ---
FROM node:26.3.0-alpine
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
