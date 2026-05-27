# agent-net — Domain Glossary

## Agent
An AI coding assistant (Claude Code, Copilot CLI, VSCode Copilot) that connects to agent-net to coordinate work with other agents.

## Session
An agent's active connection to agent-net. Created when an agent registers; destroyed on disconnect. Identified by a server-assigned **session_id**. An agent's display name is human-readable (e.g. `"claude-code"`); session_id is unique (e.g. `claude-code#a3f9`).

## Room
The coordination space for agents working on the same codebase branch. A room is automatically scoped by **git remote URL + branch name** — no manual creation or joining. Agents on the same repo and branch are in the same room; agents on different branches are isolated.

## Claim
An agent's exclusive hold on a **Claim Key** within a Room. Carries a **Claim Context** payload. A claim is connection-scoped — it is automatically released when the agent's Session ends (disconnect or crash). First agent to claim a key wins; subsequent attempts get an error with the current holder's identity.

## Claim Key
An arbitrary string identifying what an agent has claimed. No format enforced by the server. Convention: `file:<absolute-path>`, `task:<id>`, `symbol:<qualified-name>`. Scoped to a Room.

## Claim Context
Structured metadata attached to a Claim. May include: absolute file path, git branch, line range, free-text note. Carried by the claim for other agents to read.

## Broadcast
An ephemeral message sent to all agents in a Room not tied to any Claim. Used for freeform findings (e.g. "test suite is broken"). Not persisted — lost if no agents are connected.

## Hub
The internal HTTP process that owns all Room and Claim state. Managed by the agent-net stdio process — auto-started on first agent connection, reused by subsequent connections. Agents do not interact with the Hub directly; they use MCP tools via stdio.
