# OpenISMS build for the Anthropic OSS Scanner.
# Build context = OpenISMS repo root, checkout lands at /src (COPY . /src).
# Network is available during this build and removed afterwards, so every
# dependency the offline audit might need is fetched here. devDependencies are
# installed on purpose (test drivers, linters and tooling must be present).
FROM node:26.8.1-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=development \
    SCARF_ANALYTICS=false \
    DO_NOT_TRACK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

# scanner contract: the checkout lives at /src
COPY . /src
WORKDIR /src

# Backend (Express + PostgreSQL client): full install incl. devDependencies.
WORKDIR /src/backend
RUN npm ci --loglevel=error || npm install --loglevel=error

# Frontend (React): full install + production build (the backend serves the
# built assets from /app/public at runtime).
WORKDIR /src/frontend
RUN npm ci --loglevel=error || npm install --loglevel=error
RUN npm run build || echo "WARNING: frontend build reported failures"

WORKDIR /src
# Cheap smoke tests so we know the image works; a failing test must not abort the
# build (the scanner still wants the built image for the offline audit).
RUN cd /src/backend && (npm test --if-present --loglevel=error || echo "WARNING: backend tests reported failures")
