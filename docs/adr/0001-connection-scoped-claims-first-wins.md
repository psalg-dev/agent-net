# Connection-scoped claims with first-wins resolution

Claims are owned by a Session and automatically released when that session disconnects — no TTL, no explicit release required. When two agents attempt to claim the same key simultaneously, the first wins and the second receives an error containing the current holder's identity. We chose connection-scoped over TTL to eliminate orphaned claims from crashed agents without requiring heartbeat logic. We chose first-wins over queuing to keep the server stateless and push coordination decisions to the agents, which have domain context the server lacks.

## Considered Options

- **TTL with heartbeat renewal** — dropped because it requires every agent to implement a keep-alive loop and the server to run a reaper. Connection-scoped gives the same crash-safety guarantee for free via the transport layer.
- **Claim queue** — dropped because the server cannot prioritise work meaningfully. Agents should decide whether to wait, pick a different task, or notify the user.
