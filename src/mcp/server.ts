import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HubClient } from './hub-client.js';
import { ensureHub } from './launcher.js';
import type { HubEvent } from '../types.js';

const TOOLS = [
  {
    name: 'register',
    description: 'Register this agent in a coordination room. Returns a session_id required for all other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for this agent (e.g. "claude-code")' },
        repo: { type: 'string', description: 'Git remote URL or repo identifier' },
        branch: { type: 'string', description: 'Current git branch' },
      },
      required: ['name', 'repo', 'branch'],
    },
  },
  {
    name: 'claim',
    description: 'Claim exclusive ownership of a key in the current room. Returns ok or the current holder.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        key: { type: 'string', description: 'Claim key, e.g. "file:src/auth.ts" or "task:fix-bug"' },
        context: { type: 'object', description: 'Metadata to attach (file path, branch, notes, etc.)' },
      },
      required: ['session_id', 'key'],
    },
  },
  {
    name: 'release',
    description: 'Release a claim you currently hold.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['session_id', 'key'],
    },
  },
  {
    name: 'list_claims',
    description: 'List all active claims in your room.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'broadcast',
    description: 'Send an ephemeral message to all agents in your room.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['session_id', 'message'],
    },
  },
];

function text(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export async function startMCP(): Promise<void> {
  const port = await ensureHub();
  const hub = new HubClient(port);

  const server = new Server(
    { name: 'agent-net', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  let stopEvents: (() => void) | null = null;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    if (name === 'register') {
      const result = await hub.register(String(a.name), String(a.repo), String(a.branch));
      // Subscribe to room events and forward as MCP log messages
      stopEvents?.();
      stopEvents = hub.subscribeEvents(result.sessionId, (event: HubEvent) => {
        server.sendLoggingMessage({ level: 'info', data: JSON.stringify(event) }).catch(() => {});
      });
      return text(result);
    }

    if (name === 'claim') {
      const result = await hub.claim(String(a.session_id), String(a.key), (a.context as Record<string, unknown>) ?? {});
      return text(result);
    }

    if (name === 'release') {
      const result = await hub.release(String(a.session_id), String(a.key));
      return text(result);
    }

    if (name === 'list_claims') {
      const result = await hub.listClaims(String(a.session_id));
      return text(result);
    }

    if (name === 'broadcast') {
      const result = await hub.broadcast(String(a.session_id), String(a.message));
      return text(result);
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();

  process.on('exit', () => { stopEvents?.(); });
  process.on('SIGINT', () => { stopEvents?.(); process.exit(0); });
  process.on('SIGTERM', () => { stopEvents?.(); process.exit(0); });

  await server.connect(transport);
}
