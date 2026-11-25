# Getting Started

From zero to a working OpenISMS in about ten minutes, using Docker Compose with
the bundled PostgreSQL. For production setups, other install options and every
configuration variable see
[Installation and Configuration](Installation-and-Configuration).

## 1. Requirements

- Docker with the Compose plugin
- About 2 GB of free RAM and a few GB of disk
- `git` and `openssl`

## 2. Download and configure

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms
cp .env.example .env
```

Generate four random values and put them into `.env`:

```bash
for v in POSTGRES_PASSWORD JWT_SECRET SESSION_SECRET ENCRYPTION_KEY; do
  echo "$v=$(openssl rand -hex 32)"
done
```

Also set the address you will open in the browser:

```dotenv
APP_URL=http://localhost:8080
```

Optionally set `ADMIN_PASSWORD` to choose the initial administrator password.

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f openisms-app     # Ctrl+C once the server reports it is listening
```

The first start creates the database schema and seeds the catalogues; it takes
a minute.

## 4. Log in

Open <http://localhost:8080> and log in as **`admin@isms.local`**.

There is no default password. If you did not set `ADMIN_PASSWORD`, read the
generated one:

```bash
docker exec openisms-app cat /app/uploads/INITIAL_ADMIN_PASSWORD.txt
```

Change the password right away (profile picture → change password), then
delete the file:

```bash
docker exec openisms-app rm /app/uploads/INITIAL_ADMIN_PASSWORD.txt
```

## 5. First steps in the application

The dashboard's **Getting started** panel guides you. A sensible order:

1. **Enable modules** — *Administration → Modules*. GDPR, discovery and threat
   landscape are on by default; switch on ISO 27001, NIS-2, BSI IT-Grundschutz
   or others as needed.
2. **Secure your account** — set up TOTP or a passkey in your profile.
3. **Create users and groups** — *Administration → Users / Groups*, or connect
   your identity provider (*Administration → Security → Single sign-on*).
4. **Build the asset register** — add assets by hand, import a spreadsheet
   (*Import*), or let discovery propose them (*Network Discovery*). Imported and
   discovered assets wait in an approval queue.
5. **Assess protection needs and risks** — on each asset, then in the risk
   register.
6. **Work through your frameworks** — Statement of Applicability, NIS-2
   criteria and self-check, IT-Grundschutz check.
7. **Connect an AI assistant** (optional) — create an API token in your profile
   and follow [MCP Integration](MCP-Integration).

See [Features](Features) for everything else.

## 6. Before you go to production

The quick start runs over plain HTTP on your machine. Before other people use
the instance, put a TLS reverse proxy in front and work through the
[production checklist](Security-Configuration#1-production-checklist).

## Stopping and removing

```bash
docker compose down        # stop, keep data
docker compose down -v     # stop and delete all data (database and uploads)
```
