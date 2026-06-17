# syntax=docker/dockerfile:1
# Kombiniertes Single-Container-Image: Express-Backend liefert das gebaute
# React-Frontend gleich mit aus. Build-Context = Repo-Root.
#   docker build -t isms:latest .

# --- Stage 1: Frontend bauen ---
FROM node:22-alpine AS frontend-build
RUN apk add --no-cache git
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Backend + statisches Frontend ---
FROM node:22-alpine
RUN apk add --no-cache git
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
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
