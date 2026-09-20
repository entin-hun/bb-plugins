Give BB agents a clear, read-only path into explicitly selected Spool context.

## What you get

- A **Spool** page in the BB sidebar that explains setup, the MCP surface, and
  the trust boundaries around collected events.
- A full `spool` skill covering discovery, bounded pagination, source health,
  retention, citations, privacy, and when to use the CLI instead.
- A standard Agent Plugins `plugin.json` and `mcp.json` payload in the same
  package. Install the folder in Agent Plugins to expose the real `spool mcp`
  stdio server to providers.

## How it works

The BB plugin owns the page and automatic skill. The Agent Plugins payload
starts the installed `spool` command with `mcp`, then forwards its read-only
tools, resources, and prompt through the Agent Plugins bridge. The Spool
service must already be running for event queries; the adapter does not start
collection or select sources.

Every MCP tool call, resource read, and prompt read is audited by Spool with
redacted metadata. Arguments, query text, event payloads, and credentials are
not written to the usage log.

## Requirements

Install the `spool` CLI on the BB host and keep it available on `PATH`. Install
the BB **Agent Plugins** plugin before enabling the bundled MCP payload. Local
event reads also require a running Spool service and explicitly selected
sources. Remote profiles use Spool's normal connection and scope rules.
