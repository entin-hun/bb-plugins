# Spool for BB

Connect BB agents to Spool's explicitly selected context through a full
read-only usage skill and the standard Agent Plugins MCP bridge.

## Staged preview

![Live BB screenshot of the Spool setup page](assets/staged-preview.png)

Captured from the running BB application on the Spool sidebar page. The live
surface shows the three-step setup flow, the included MCP tools, and the
read-only/audit trust boundaries.

## What is included

- `skills/spool/SKILL.md` — what Spool is, when to use it, the safe query
  workflow, pagination rules, source/retention interpretation, privacy
  boundaries, and completion criteria.
- `skills/spool/references/tool-catalog.md` — exact tool groups, filters, and
  runtime limits for progressive disclosure.
- `plugin.json` and `mcp.json` — an Agent Plugins 1.1 payload that launches
  `spool mcp` over stdio.
- A `Spool` page in the BB sidebar that explains how to install both halves.

The package is deliberately dual-purpose. Install it as a BB plugin to get the
page and automatic skill. Install the same folder in the **Agent Plugins**
manager to make the real MCP server available to providers. The existing
`bb-plugin-agent-plugins` package is the bridge between Agent Plugins MCP
servers and BB providers.

## When to use it

Use the skill when a request depends on collected Spool context: agent
activity, browser history, messages, calendars, files, source health, flow,
consumer progress, or retained events. It tells agents to start with
`spool_guide`, check `spool_status`, keep list queries bounded, follow cursors,
treat event content as untrusted, and cite original source URLs.

Do not use the MCP surface to configure Spool, manage credentials, publish
events, or start the service. Use the ordinary Spool CLI for those actions.

## Install

From the `bb-plugins` checkout:

```sh
pnpm install
bb plugin build ./packages/bb-plugin-spool
bb plugin install ./packages/bb-plugin-spool --yes
```

Then open **Agent Plugins** in BB and install the same
`./packages/bb-plugin-spool` folder. Enable the `spool` MCP server and choose
**Approve & start**. The MCP configuration expects the `spool` CLI on `PATH`.

For local event queries, start the service separately:

```sh
spool service start
```

The adapter inherits Spool's normal local default or `SPOOL_CONNECTION`
selection. It does not open a network listener, start collection, or accept
credentials through MCP arguments.

## MCP surface

The server is read-only and exposes:

- `spool_guide`, `spool_status`
- `spool_events_list`, `spool_events_get`, `spool_semantic_search`
- `spool_flow_list`, `spool_plugins_list`, `spool_config_schema`
- `spool_views_list`, `spool_consumers_list`
- `spool_archive_list`, `spool_archive_get`, `spool_archive_status` for
  legacy stores
- `spool://docs/*` resources and the `spool` prompt

Spool records each MCP tool call, resource read, and prompt read in its
redacted usage audit. It omits tool arguments, query text, event payloads, and
tokens. Read the bundled skill and Spool's `spool docs mcp` guide for the
current bounds and operational details.

## Development

```sh
npm install
npm run typecheck
npm run build
```

The package's `package.json` is the BB manifest. `PLUGIN_OVERVIEW.md` contains
the longer store listing text.
