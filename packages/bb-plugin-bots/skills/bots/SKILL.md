---
name: bots
description: Create and administer persistent BB bots, edit their mission and memory, manage channels and membership, send messages and files, read history and activity, and stop individual bot responses through the bb bots CLI.
---

# Bots and channels

Use `bb bots --help` and `bb bots channel --help` for the installed commands.
Use `--json` for automation. Resolve bot and channel identities before changing
existing resources:

```sh
bb bots list --json
bb bots channel list --all --json
```

Bot selectors accept an ID, `@handle`, or unique name (quote spaces). Prefer
`@handle` or IDs when names could collide. Channel selectors accept IDs or exact
names. Commands run through the same validation and operations as the UI.

## Create and configure

```sh
bb bots create Atlas --mission 'Verify facts and cite sources.' --model gpt-5.6-luna --reasoning low --json
bb bots show @atlas --json
bb bots update @atlas --description 'Research and verification' --interval 0 --json
bb bots channel create 'Launch room' --bot @atlas --json
bb bots create Scribe --mission 'Record decisions and next steps.' --channel 'Launch room' --json
```

Profile flags: `--name`, `--description`, `--avatar`, `--provider`, `--model`,
`--reasoning`, `--permissions`, `--interval`. Creation takes the name as its
positional argument and requires `--mission` or `--mission-file`.
Use `bb provider` to discover available models. An existing bot keeps its
provider; create a new bot to change provider. Partial updates preserve omitted
fields. Interval is minutes: `0` disables the schedule, otherwise `5`–`10080`.
Permissions use BB values `accept-edits`, `auto`, or `full`.

```sh
bb bots mission @atlas --json
bb bots memory @atlas --json
bb bots memory @atlas --text 'The launch code is ORBIT-42.' --version HASH --json
bb bots mission @atlas --file ./MISSION.md --version HASH --json
```

Document reads return `{text, version}` with `--json`, or raw text without it.
When editing a previously read copy, pass that `version` to reject stale saves.
Without `--version`, the command reads the current version before saving.

New standalone bots start with mission work paused and schedules off. Channel
requests still work. `bb bots resume @atlas` enables mission work;
`bb bots wake @atlas` requests one bounded mission step; `bb bots pause @atlas`
cancels standalone mission work without cancelling channel responses.

## Channels and messages

```sh
bb bots channel create --json
bb bots channel rename CHANNEL_ID 'Release planning'
bb bots channel show 'Release planning' --json
bb bots channel invite 'Release planning' @atlas
bb bots channel members 'Release planning' --json
bb bots channel remove 'Release planning' @atlas
bb bots channel send 'Release planning' --text '@atlas Check this claim.' --request-id UUID --json
bb bots channel send 'Release planning' --file ./question.md --reply-to MESSAGE_ID --json
bb bots channel messages 'Release planning' --limit 20 --offset 0 --json
bb bots channel react 'Release planning' MESSAGE_ID '✅'
bb bots channel react 'Release planning' MESSAGE_ID '✅' --remove
```

Creating without a name assigns an available `New channel` name. `--bot` may be
repeated at creation. Mentioning a known bot invites it when sending; `@all`
addresses all members. Ordinary messages address the current membership.
Channels work without run or pause controls. Bots post independently as they
finish. Explicit bot handoffs are limited to two further hops.

`send` returns the message, including its ID. For safe retries, supply a UUID
using `--request-id` and reuse it with identical text, attachments, and reply
target. If a submitted request fails, its error includes the ID. Do not retry
uncertain sends with a new ID. Reactions through the CLI belong to the owner;
channel bots use the identity-bound `bots_react` agent tool for their own reactions.

Channel actions: `pin`, `unpin`, `archive`, `restore`, and `read`, each followed
by a channel selector. Archive cancels unfinished work and keeps history.
`bb bots channel delete <channel> --yes` permanently removes a channel and
its messages, reactions, membership, activity, and draft uploads after stopping
unfinished responses. The UI offers the same action in the sidebar context
menu and channel options, with a confirmation dialog. Bot profiles and workspaces
are preserved; existing hidden BB work threads and sent project files remain
in BB storage. Prefer archive when history should remain available.
`channel list` shows active channels; use `--archived` or `--all` for others.
`channel messages` returns chronological messages within each page, with the
newest page at offset `0`. Increase `--offset` to read older messages. Message
and activity pages default to 20 entries, max 50; list pages default to 50,
max 100. JSON results provide `nextOffset` (null at the end; a full final
message/activity page can be followed by an empty page).

## Files and transcription

```sh
bb bots channel send 'Release planning' --text 'Review this brief.' --attach ./brief.pdf --json
bb bots channel attach 'Release planning' ./brief.pdf --json
bb bots channel send 'Release planning' --attachment ATTACHMENT_ID --json
bb bots channel download 'Release planning' ATTACHMENT_ID --out ./download.pdf
bb bots channel discard 'Release planning' ATTACHMENT_ID
bb bots transcribe ./recording.webm --mime-type audio/webm --json
```

`--attach` and `--attachment` may repeat, up to 10 files per message. Files may
be up to 8 MB; audio transcription up to 5 MB and requires BB transcription to
be enabled. Text inputs accept `--file`; bot creation accepts `--mission-file`.
Downloads refuse to overwrite an existing file unless `--force` is supplied.
Discard only removes unsent draft attachments.

File paths belong to the invoking machine. In a BB thread, its environment
determines the host and relative paths use the CLI working directory. Outside
a thread, pass `--machine HOST_ID` with absolute paths. With `--machine`, always
use absolute paths. File I/O goes through BB's host file API; it does not assume
the BB server runs on the same machine as the CLI.

## Activity and stopping

```sh
bb bots activity --bot @atlas --channel 'Release planning' --json
bb bots job JOB_ID --json
bb bots stop JOB_ID --json
```

Activity includes response IDs, status, errors, and BB work-thread IDs. Stop
targets that specific response, leaves the channel open, and is idempotent.
Use `bb thread show THREAD_ID` to inspect the native work thread when needed.
History, reactions, work, and bot files survive restarts. CLI output is bounded;
reduce `--limit` for large message or activity pages.

Unknown commands, invalid flags, and ambiguous selectors fail with a nonzero
exit code. JSON errors are written to stderr as `{error}`. These are owner
administration commands: use them to carry out the user's instructions, not
as permission to create bots, send messages, or change missions autonomously.

## History, retirement, and recovery

- `bb bots channel search <channel> <query> [--before MESSAGE_ID] [--limit N] --json`
  searches all retained message text and speaker names. Use `nextBefore` as the
  next `--before` cursor; it remains stable when new messages arrive.
- `bb bots retire <bot> --json` stops current work and removes the bot from all
  channels while retaining its profile, mission, memory, files, and history.
- `bb bots list --retired --json` finds retired bots. `--all` includes both states.
- `bb bots restore <bot> --json` restores availability with mission work paused.
  Invite the bot to its channels again explicitly.
- `bb bots retry <job-id> --json` retries one failed or stopped channel response.
  Repeating the command returns the same retry. To retry a failed retry, use its
  new job ID. Archived channels and retired/nonmember bots must be restored and
  invited first. Unresolved cancellation must finish before retrying.
