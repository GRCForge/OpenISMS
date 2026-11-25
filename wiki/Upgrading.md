# Upgrading

## Version policy

- OpenISMS uses semantic versions: **patch** releases fix bugs and security
  issues, **minor** releases add features, **major** releases may break
  compatibility.
- **Only the latest release receives security fixes** (see
  [Security Policy](Security-Policy)). Stay current.
- Every release has release notes; they name any action you have to take.
  See [Release Notes](Release-Notes).
- The container tag `latest` is rebuilt on every merge to `main`. Pin a
  version (`v3.5.1`, `3.5.1`) in production and upgrade deliberately.

## Before every upgrade

1. Read the release notes of every version between yours and the target.
2. Back up the database and the uploads volume — see
   [Installation and Configuration – backup and restore](Installation-and-Configuration#9-backup-and-restore).
3. Keep your `.env` unchanged. In particular never change `ENCRYPTION_KEY`
   during an upgrade.

## Upgrade

**Docker Compose with bundled database**

```bash
git pull
docker compose up -d --build
```

**Pre-built image**

```bash
export ISMS_VERSION=v3.5.1
docker compose -f docker-compose.ghcr.single.yml pull
docker compose -f docker-compose.ghcr.single.yml up -d
```

**Install script (Docker or systemd)**

```bash
sudo bash install.sh update
```

**Configuration management (Ansible, Semaphore, …)** — make sure your playbook
actually deploys the new code and does not only restart the service. Check
afterwards:

```bash
curl -s https://isms.example.com/api/version
```

> **Bare-metal deployments with `rsync --delete`:** exclude the upload
> directory (and anything else created at runtime, such as `node_modules`) from
> the sync. Otherwise every deployment deletes uploaded documents that live
> inside the application directory.

Database migrations run automatically on start. Watch the log of the first
start after an upgrade.

## After the upgrade

- `GET /api/version` shows the new version; the footer of the web UI too.
- Check the startup log for warnings, e.g. `[Uploads]` lines about missing or
  moved documents.
- Create a fresh in-app backup.

## Upgrade notes by version

Changes that need attention when you upgrade across them:

| Version | What to know |
|---|---|
| **3.8.0** | Database migrations. Roles now reach users only through groups; the first start creates one group per role in use and keeps everyone's access. New users get **no role** unless they are added to a group (or SSO puts them in the default group). MCP `isms_delete_user` deactivates instead of deleting. Review **Administration → Groups** afterwards — see [Release Notes v3.8.0](Release-Notes-v3.8.0) |
| **3.5.1** | API clients that send a token in the query string (`?token=`, `?api_key=`, `?access_token=`, `?key=`) on normal REST calls now get `401`. Send it in the `Authorization: Bearer` header. Server-sent event streams and MCP are unaffected |
| **3.5.0** | Database migrations. Existing BSI requirements are attached to a new default information domain; status data is kept |
| **3.4.0** | Database migrations. The built-in BSI excerpt becomes a versioned catalogue. New optional variable `BSI_CATALOG_URL_HOSTS` |
| **3.3.9** | `MCP_SECRET` now acts as role `viewer` by default (before: `admin`). Set `MCP_SECRET_ROLE` explicitly if you depend on it — better, switch to API tokens. IdP tokens only map to local accounts with `email_verified=true` |
| **3.3.8** | IdP access tokens on `/mcp` must carry the audience `<APP_URL>/mcp`. Add an audience mapper at your IdP before upgrading if you use OAuth for MCP — see [MCP Integration](MCP-Integration#5-sso--oauth-21-setup) |
| **3.3.5** | Browser requests to `/mcp` from origins other than `APP_URL` get `403` unless listed in `MCP_CORS_ORIGINS` |
| **3.3.2** | Bare installs: policy documents move into `UPLOAD_DIR` on first start. Restore no longer deletes existing files. `INITIAL_ADMIN_PASSWORD.txt` is excluded from backups — delete it if it still exists. Make a fresh backup after upgrading |
| **3.0.0** | Moved from MySQL to PostgreSQL. **There is no upgrade path from 2.2.x**; 2.2.x is out of support |

The full details are in each version's [release notes](Release-Notes).
