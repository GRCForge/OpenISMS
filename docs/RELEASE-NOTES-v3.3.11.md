# OpenISMS v3.3.11 — MCP sessions survive a server restart

Maintenance release. No migrations, no breaking changes.

## Fixes

| Problem | Change |
|---|---|
| After a restart (e.g. an update) the in-memory MCP sessions are gone. Requests from a connected client with its old `Mcp-Session-Id` were handed to a fresh, uninitialized transport and answered with `400 Server not initialized`. Clients (Claude connector, mcp-remote) treat 400 as a hard error and stayed broken until manually reconnected. | Unknown or expired session IDs on `POST`, `GET` and `DELETE /mcp` now return `404` with JSON-RPC error `-32001 Session not found`, as required by the MCP Streamable HTTP transport ("Session Management"). Clients then start a new session automatically. Requests without a session ID are unchanged. |
