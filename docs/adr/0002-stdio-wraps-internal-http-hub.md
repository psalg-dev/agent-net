# stdio MCP wraps an internal HTTP Hub

Agents configure agent-net as a standard stdio MCP server. Internally, the stdio process auto-starts a shared HTTP Hub on first launch (checking a lockfile to reuse an existing one) and proxies all MCP tool calls to it. The Hub owns all Room and Claim state and pushes events via SSE. This allows multiple agents — each with their own stdio MCP process — to share a single in-memory state space without any agent-side configuration beyond the standard MCP server entry. Agents never interact with the Hub directly.

## Consequences

Hub restart drops all Sessions and Claims. Agents must reconnect and re-claim. This is acceptable because Claims are cheap to re-acquire and the Hub is a local process on the developer's machine.
