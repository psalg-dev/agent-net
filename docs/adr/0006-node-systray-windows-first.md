# Windows-first tray via node-systray

The tray uses `node-systray` (a precompiled Go binary, ~3MB) rather than Electron. The scope is Windows-first; cross-platform support is not a current requirement. Electron was rejected because it adds ~200MB for a menu with three items and no browser window — an unreasonable footprint for a background daemon. `node-systray`'s flat menu model is sufficient because the "Install" submenu requirement was dropped in favour of three direct flat menu items. The precompiled Go binary's supply chain risk is lower than a deep npm dependency tree: it is a single, auditable binary whose only job is to render a tray icon and emit click events.

## Consequences

Submenus are not supported by `node-systray`. If submenus become a requirement later, this decision must be revisited. Mac and Linux tray support would require either a cross-platform library (Electron) or platform-specific binaries.
