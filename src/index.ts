const args = process.argv.slice(2);

if (args.includes('--hub')) {
  const { startHub } = await import('./hub/server.js');
  const port = parseInt(process.env.AGENT_NET_HUB_PORT ?? '37842', 10);
  await startHub(port);
  process.send?.({ ready: true, port });
  // Hub runs until process is killed
} else {
  const { startMCP } = await import('./mcp/server.js');
  await startMCP();
}
