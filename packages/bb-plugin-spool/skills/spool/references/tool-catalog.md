# Spool MCP tool catalog

Use this reference after the main skill selects Spool. The authoritative live
schemas still come from MCP tool discovery or `spool docs mcp`.

## Discovery and guidance

| Tool | Inputs | Use |
| --- | --- | --- |
| `spool_guide` | `topic` from `agents__, `mcp__, `getting-started__, `configuration__, `plugin-sdk__, `protocol__, or `operations__ | Read bundled guidance without starting the service. |
| `spool_status` | none | Inspect the selected service and live cache. |

## Canonical and semantic reads

| Tool | Inputs | Use |
| --- | --- | --- |
| `spool_events_list` | `source__, `type__, `search__, `view__, `cursor__, `limit__ | Read one bounded canonical-cache page. |
| `spool_events_get` | required `id__ | Read one retained canonical event. |
| `spool_semantic_search` | required `query__; optional `mode__, `source__, `type__, `limit__ | Search an enabled semantic index. |

List and semantic text filters are at most 4096 characters and cannot contain
NUL. IDs are 1–1024 characters, cannot contain NUL, and cannot start with a
hyphen. `limit` is an integer from 1 to 100 and defaults to 20. Keep filters
unchanged while following a returned cursor.

## Flow and administration metadata

These are still read-only MCP queries. They expose metadata; use the CLI for
changes.

- `spool_flow_list` — optional `plugin` filter; inspect publisher/subscriber
  contracts, observed activity, live connections, and checkpoints.
- `spool_plugins_list` — discover plugin IDs, descriptions, enabled state, and
  health.
- `spool_config_schema` — optional plugin `id`; read settings schemas before a
  CLI configuration change.
- `spool_views_list` — discover saved filters and monitor rules.
- `spool_consumers_list` — inspect consumer checkpoints, lag, and gaps.

## Legacy archive compatibility

- `spool_archive_list` — same bounded filters as `spool_events_list`.
- `spool_archive_get` — required event `id`.
- `spool_archive_status` — inspect whether the optional legacy archive exists.

New stores keep canonical history in SQLite and export older rows to JSONL cold
backups. Do not present those backup files as an online MCP query source.

## Result and runtime limits

The adapter returns the existing CLI JSON as both structured content and JSON
text. A query has a 45-second deadline, the combined output limit is 8 MiB,
and at most four queries run concurrently per adapter. Busy, unavailable,
expired-cursor, and command failures are tool errors. There are no live event
subscriptions in this adapter.
