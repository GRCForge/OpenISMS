# OpenISMS – Claude Code Entwicklungsregeln

## Branching-Strategie

Alle Änderungen am Code werden auf **versionierten Branches** entwickelt, niemals direkt auf `main`.

### Branch-Benennung (Semver)

| Art der Änderung | Schema | Beispiel |
|---|---|---|
| Neues Feature | `release/vX.(Y+1).0` | `release/v2.3.0` |
| Bug-Fix / Minor-Verbesserung | `release/vX.Y.(Z+1)` | `release/v2.2.2` |
| Security-Fix | `security/vX.Y.(Z+1)` | `security/v2.2.2` |
| Breaking Change / Major Release | `release/v(X+1).0.0` | `release/v3.0.0` |

### Ablauf

1. Vor jeder Änderung: aktuelle Version aus `VERSION`, `backend/package.json` und `frontend/package.json` prüfen.
2. Prüfen ob bereits ein Branch existiert, der neuere Commits als `main` hat:
   - Falls ja: diesen Branch verwenden. Passt der Name nicht zum Schema der geplanten Änderung, den Branch lokal und remote umbenennen.
   - Falls nein: neuen Branch nach obiger Tabelle anlegen.
3. Änderungen committen und Branch pushen.
4. **Keinen Pull Request erstellen** – das übernimmt der Repository-Owner zentral.
5. Die Versionsnummer in `VERSION`, `backend/package.json` und `frontend/package.json` wird erst beim Merge in `main` angehoben (oder explizit angewiesen).

### Aktuelle Version

`2.2.1` – nächster Minor-Release wäre `release/v2.3.0`, nächster Patch `release/v2.2.2`.
