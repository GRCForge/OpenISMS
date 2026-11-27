# FAQ

## General

**What is OpenISMS?**
An Information Security Management System: the asset register, risk
management, controls, policies, incidents, vendors, privacy and audits in one
application, with framework modules for ISO 27001, NIS-2 / BSIG, GDPR, BSI
IT-Grundschutz, BSI C5, TISAX, DORA and the EU AI Act. See [Features](Features).

**Is it free?**
OpenISMS is source-available: free for private and non-commercial use.
Commercial or enterprise use and redistribution require a commercial licence —
contact info@herz.dev.

**Is there a hosted (SaaS) version?**
OpenISMS is designed for self-hosting: one container plus PostgreSQL, on your
own infrastructure.

**Which languages does the UI support?**
English, German and Spanish. Translations are managed with Crowdin; see the
[Translation Style Guide](Translation-Style-Guide).

## Compliance

**Does using OpenISMS make us ISO 27001 certified or NIS-2 compliant?**
No tool does. OpenISMS structures the work and keeps the evidence — the
register, the Statement of Applicability, risk treatment, audit trail — that an
auditor or authority expects to see. The measures themselves are yours.

**Which frameworks can I use at the same time?**
All of them. Controls are shared across frameworks through the
cross-framework mapping, so one implemented control counts wherever it applies.

**Are the BSI IT-Grundschutz catalogues included?**
A built-in excerpt is. The full IT-Grundschutz-Kompendium or a Grundschutz++
catalogue is imported at runtime, by upload or from the BSI's website, and
activated after a preview.

**How does OpenISMS handle the German NIS-2 implementation (BSIG)?**
The NIS-2 catalogue includes the BSIG paragraphs and the German duties without
a counterpart in the directive (registration, informing recipients, duties of
critical facility operators), with applicability per entity profile. See
[Features](Features#nis-2-and-the-german-bsig).

## Operations

**What do I need to run it?**
Docker (or Node.js for bare metal) and PostgreSQL 15 or newer. Apache AGE is
optional. See [Installation and Configuration](Installation-and-Configuration).

**Can I run several instances for high availability?**
Not against the same database at the moment: some short-lived session state
lives in process memory. Run one instance and rely on fast restarts and
backups.

**How do I back it up?**
Use the in-app backup and, in addition, `pg_dump` plus a copy of the uploads
volume. Keep `ENCRYPTION_KEY` safe and separate. See
[Security Configuration – backups](Security-Configuration#8-backups).

**Can I use my identity provider?**
Yes, any OIDC provider (Entra ID, Keycloak, Authentik, Google, Okta, Zitadel …),
with IdP groups mapped to OpenISMS groups (which carry the roles). See
[Installation and Configuration](Installation-and-Configuration#single-sign-on-oidc).

**Is SAML supported?**
Not directly. Use an IdP that offers OIDC, or bridge SAML to OIDC at your IdP
(for example with Keycloak).

## AI

**What does the AI integration do?**
Two things, both optional: the **MCP server** lets AI assistants such as Claude
read and change ISMS data under the user's permissions
([MCP Integration](MCP-Integration)), and **AI document review** checks vendor
documents and your own policies against requirement catalogues
([Features](Features#18-ai-assisted-document-review)).

**Does my data go to an AI provider?**
Only if you configure one and use these features. With Ollama, document review
runs entirely in your network. MCP sends data to whichever assistant you
connect.

**Can an AI assistant do more than the user it acts for?**
No. Every MCP call runs as an OpenISMS user and passes the same permission
matrix, module switches and write restrictions as the web UI.

## Contributing

**How can I contribute?**
See [Contributing](Contributing). Bug reports, feature requests, translations
and pull requests are welcome. Commit messages, pull requests and documentation
are written in English.

**I found a vulnerability.**
Please don't open a public issue — see [Security Policy](Security-Policy).
