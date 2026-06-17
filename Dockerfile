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
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Backend + statisches Frontend ---
FROM node:26.3.0-alpine
RUN apk add --no-cache git && npm install -g npm@11 --loglevel=error
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
# --loglevel=error suppresses the dottie deprecation warning (transitive dep of
# sequelize@6; dottie@2.0.7 is the latest version — no fix available upstream).
RUN npm ci --omit=dev --loglevel=error
COPY backend/ ./
# Gebautes Frontend wird von Express aus /app/public ausgeliefert (siehe src/index.js)
COPY --from=frontend-build /frontend/dist ./public
# Versionsdatei fuer /api/version
COPY VERSION ./VERSION
RUN mkdir -p /app/uploads
EXPOSE 3001
CMD ["node", "src/index.js"]
