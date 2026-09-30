# OpenISMS v3.3.2 — every document in the backup

**A data-integrity fix. Upgrade promptly if you run OpenISMS outside Docker.**

On installations where `UPLOAD_DIR` does not point to `<working directory>/uploads`,
policy documents were stored outside `UPLOAD_DIR` — and therefore outside every
backup made with the built-in backup function. A restore brought the policies
back into the database, hash and all, but not a single file. Nothing reported
this: the gap only showed when someone tried to download a policy.

This release puts every document in one place, moves the ones that landed
elsewhere, makes the backup say what it contains, and makes restore
non-destructive.

---

## 1. Who is affected

| Setup | Policies stored in | Affected |
|---|---|---|
| Docker (`docker-compose.yml`, `docker-compose.ghcr.single.yml`) | `/app/uploads/policies` — working directory `/app`, `UPLOAD_DIR=/app/uploads` | **no** — both paths happened to coincide |
| Bare install, e.g. `WorkingDirectory=/opt/isms/backend`, `UPLOAD_DIR=/opt/isms/uploads` | `/opt/isms/backend/uploads/policies` | **yes** |
| Local development, `UPLOAD_DIR` unset, started from `backend/` | `backend/uploads/policies` | no |

The cause was a single route: `routes/policies.js` resolved its directory as
`path.resolve('uploads/policies')` — relative to the process's working
directory — while every other document type used `UPLOAD_DIR`.

**Only policies were affected.** Contracts, DPAs, certificates, risk reports and
risk acceptances (all stored through the `documents` table) and templates were
always stored under `UPLOAD_DIR` and were always in the backup.

## 2. What changed

### One place decides where documents live

`backend/src/services/uploadStorage.js` now resolves the upload location for the
whole backend. Six places computed it separately before; the policy route was
the one that differed. A test now fails if any source file reads
`process.env.UPLOAD_DIR` itself or uses an upload path relative to the working
directory.

### Existing policies move automatically

On start, before the server accepts requests, files from the old location
(`<working directory>/uploads/policies`) are moved to `UPLOAD_DIR/policies`:

- **Nothing is ever overwritten.** If a file of the same name already exists at
  the target, the old one stays where it is and is named in the log. The move
  uses a hard link, which fails atomically if the target exists, and falls back
  to an exclusive copy across filesystems.
- Emptied directories are removed; `UPLOAD_DIR` itself never is.
- Symbolic links are not followed.
- The database needs no change: policies are resolved by file name against
  their directory, not by a stored path.
- On Docker the old and new location are the same directory; the move is a
  no-op.

The log shows one line when files were moved:

```
[Uploads] 12 Datei(en) von einem alten Ablageort nach /opt/isms/uploads umgezogen.
```

If the move fails, the service still starts and the files stay where they
were. Nothing is lost; the reason is in the log.

### The backup says what it contains

`backup-meta.json` gains a `files` section:

```json
"files": {
  "count": 214,
  "bytes": 58123776,
  "referenced": 214,
  "missing": 0,
  "missing_by_type": { "document": {…}, "template": {…}, "policy": {…}, "policy_version": {…} }
}
```

`missing` counts database entries whose document is not on disk at export time.
It should be `0`. The same figure goes into the audit log entry of the export.
The service also checks this on every start and logs a warning if anything is
missing.

### The one-time admin password is no longer backed up

On first start without `ADMIN_PASSWORD`, OpenISMS writes a generated password to
`INITIAL_ADMIN_PASSWORD.txt` in `UPLOAD_DIR`. Because the backup archived
`UPLOAD_DIR` in full, that file — if nobody deleted it — ended up **in clear
text in every backup ZIP**. It is now excluded from export, and a restore never
writes it back.

### Restore no longer deletes documents

Until now, restore **deleted `UPLOAD_DIR` entirely** and then wrote back what the
backup contained. With policies moving into `UPLOAD_DIR`, that would have turned
this fix into data loss: a backup made before v3.3.2 contains no policies, and
restoring it would have deleted every one of them while the database kept
listing them.

Restore now overlays: files from the backup are written, files not in the
backup stay. The worst case is an orphaned file with no database entry, which
is harmless.

There was a second problem with the old approach. On Docker, `UPLOAD_DIR` is a
volume mount point, and removing a mount point fails with `EBUSY` (verified).
The old restore therefore ended in an error at the file step — **after** the
database had already been restored — and wrote no files back.

Deleting the directory had one side effect worth keeping: it removed any
symbolic links. Restore therefore never writes through a link — the file is
opened with `O_NOFOLLOW`, and its actual parent directory must lie inside
`UPLOAD_DIR`. Paths escaping `UPLOAD_DIR` were already rejected and still are.

After a restore the response and the audit log report `files_restored`,
`files_rejected` and `files_missing`. When database entries point to documents
that are neither in the backup nor on the server, the admin page shows a
warning naming how many.

## 3. What to do

**Bare installs:** update as usual. On first start, check the log for the
`[Uploads]` line. If it reports conflicts, compare the two files it names and
decide which one to keep — OpenISMS will not decide that for you.

**If you restored from a backup before this release**, check whether your policy
documents are actually present: download one, or look at the startup log, which
now warns when the database references missing files.

**If you never deleted `INITIAL_ADMIN_PASSWORD.txt`:** delete it now, and treat
backup ZIPs made before this release as containing that password. It is only a
risk if the password was never changed after first login — the file holds the
initial value, not the current one.

**Make a fresh backup after updating.** Backups made before v3.3.2 on an affected
installation do not contain your policies.

No schema changes, no configuration changes, no API removals.
