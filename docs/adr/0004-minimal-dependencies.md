# Zero runtime dependencies beyond the official MCP SDK

The only runtime dependency is `@modelcontextprotocol/sdk`. All HTTP and SSE logic uses Node.js stdlib (`http`, `events`, `crypto`). We chose this because npm supply chain attacks are a live threat and every transitive dependency is an attack surface. The MCP SDK is Anthropic-maintained and audited. Node stdlib is not an attack vector. Express, Fastify, and utility libraries are unnecessary — SSE and HTTP routing for this server are under 100 lines with raw Node `http`.

## Consequences

No external HTTP framework. All routing and middleware written explicitly. This is a deliberate constraint — do not add runtime npm dependencies without a separate ADR justifying the surface area.
