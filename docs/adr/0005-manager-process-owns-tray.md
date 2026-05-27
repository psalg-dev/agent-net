# Manager process owns the tray, separate from the Hub

The system tray icon is owned by a new Manager process, not by the Hub. The Hub remains a headless HTTP server (per ADR 0002). The Manager starts the Hub on launch (reusing the existing lockfile mechanism), then shows the tray. This keeps GUI concerns out of the Hub and means the tray can survive Hub restarts, show Hub health, and be started independently of any agent connection.

## Considered Options

- **Hub gains the tray** — dropped because it mixes HTTP server and GUI event loop in one process. The Hub would need a native GUI dependency and a separate thread for the event loop. Any Hub crash takes the tray with it.
- **Electron wraps everything** — dropped (see ADR 0006).
