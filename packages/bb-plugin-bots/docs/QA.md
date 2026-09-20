# Bots and Channels verification

## Channel automations — 2026-09-20

Verified against the running BB app and its installed Automations plugin in
`Channel automations QA` with a temporary `Schedule QA` bot.

- The real bot used native tools to create and list a paused weekday schedule.
  Both channel and bot identity were inferred from its active response.
- A manual run dispatched through the existing Automations scheduler and posted
  `Scheduled channel verified: ORBIT-42.` under the bot's identity.
- An enabled one-shot timer fired without a manual run and posted
  `One-shot channel timer verified.` The schedule disabled itself afterward.
- The real channel menu/dialog exercised Resume, Pause, Run now, Delete/Cancel,
  and confirmed Delete. A UI-triggered run posted `CLI schedule verified.`
- Archive rejected a manual channel run; restore and plugin reload retained
  schedules and history. Test schedules were paused after verification.
- Live capture found that manual dispatches have a status without `lastRunAt`.
  The dialog now displays that status without requiring a scheduled-run timestamp.
  The capture asserts the real saved task, bot, timezone, state, and dispatch result.
- Nine regression tests cover inferred identity, membership/ownership,
  idempotent create and delivery, current context, overlapping work, one-shot CLI
  input, inactive targets, recursive schedules, retry provenance, and a run that
  expires while waiting for the channel lock, plus bounded run history.
- Read-only review caught lost automation provenance on retry and stale dispatch
  authorization after waiting for a lock. Both fixes passed regression tests and
  rereview. The full Bots suite has 101 passing tests, including concurrent channel
  title work, hostile-message isolation, restart-worker reuse, stale-worker selection,
  and the manual-rename race. Typecheck and build pass.

Screenshot: [Channel automations](../assets/channel-automations.png).
Capture with `BB_CAPTURE_ONLY=bots-automations`; restore the QA channel if archived.
`BB_CAPTURE_QA_ACTIONS=1` additionally exercises UI actions against a seeded paused
`CLI daily check` schedule and verifies the dialog at 390 × 844. It deletes that
disposable schedule after requesting a manual run.
`BB_CAPTURE_QA_LAYOUT=1` checks responsive layout without rerunning actions;
`BB_CAPTURE_QA_HISTORY=1` verifies the saved manual dispatch inside the dialog.
Live QA caught an unsupported cross-plugin navigation link; Run history now uses
the Automations RPC and displays bounded, paginated history within the channel.

Verified in the running BB application on 2026-09-20 using isolated QA Echo,
QA Review, and a QA channel. Existing owner bots and channels were preserved.

## Baseline

- New channel opens directly into an empty, focused composer.
- The first message in a blank channel is sent to a hidden, short title task;
  its result updates the sidebar and header without adding a second chat message.
  The task receives the first message as untrusted JSON data and has no Bots
  tools. A manual rename wins if it happens before the title task finishes, and
  startup recovery retries a title if BB restarts and reuses an in-flight hidden
  worker instead of spawning a duplicate.
- Header rename updates the sidebar and channel; membership uses stacked avatars,
  a member menu, and Add bot at the bottom.
- Mention search lists existing bots and Create new bot; sending a mention invites
  its recipient. The real agent returned the requested readiness sentence.
- Two real bots worked concurrently, read a local attachment, and independently
  returned its verification code. Replies appeared as they completed.
- Individual Stop cancelled the selected host response and removed its work stub;
  the channel remained usable.
- Reply prefills the bot mention and preserves the parent reference. Hover actions
  and keyboard focus expose the message toolbar. Emoji search found an otter,
  persisted a reaction, and CLI removal removed it.
- Sent attachment download matched the uploaded file byte for byte.
- CLI creation, profile edits, mission pause/resume, memory reads/writes, channel
  invites/removal, pin/unpin, archive/restore, history, activity and job lookup
  exercised the same service as the UI. Focused CLI tests cover argument validation,
  deletion confirmation, file handling, pagination, stale document versions, and
  request retry identity.
- Profile and memory drafts survived navigation and reload. Pause/resume did not
  invalidate a dirty profile. A newer CLI document edit preserved the old draft
  and disabled stale Save. Reload asks before discarding that draft.
- Collection search/filter/sort, profile controls, bounded document editors,
  full emoji categories/skin tones/keyboard selection, channel title placement,
  and native composer spacing are asserted by the live capture script.
- Full workspace typecheck, build, and existing test suites passed. The Bots
  baseline has 60 tests, including cancellation retry, unresolved dispatch cleanup,
  thread pagination recovery, stale thread removal, and stale profile saves.

Actual microphone recording and transcription are environment-dependent and were
not exercised end to end. The recorder error path is guarded against sending
partial audio; availability follows BB's voice configuration.

## Screenshots

The capture script drives the real BB UI with deterministic demo conversations.
Published images use BB's collapsed sidebar to omit unrelated local project names.

## Completion features

- A separate 215-message channel was seeded through the real CLI. Initial loading
  showed 200 messages plus Load earlier; search found the first message, selection
  loaded the missing page and focused it, and an old reply retained its reference.
- Retirement and restoration worked through both UI and CLI. Retirement removed
  channel membership; restoration kept mission work paused and required reinviting.
- A temporary bot using an invalid model produced a real failed response. View work
  opened its native BB thread. After correcting its model, Retry produced
  `RECOVERY VERIFIED.` without repeating the owner's message.
- Added focused tests for stable history cursors, literal search, cross-channel
  cursor rejection, old reply parents, retirement preservation/cleanup, filtered
  CLI commands, and idempotent response retry.
- Independent runtime and UI reviewers found no remaining major issues after fixes.

The completed suite has **67 passing tests**. Final typecheck and build pass.
The UI attachment input and removal flow, create-from-mention with draft preservation,
activity dialog, and confirmed channel deletion were also exercised live. Temporary
QA channels were deleted and QA bots retired after testing.

At a 390 × 844 viewport the channel header, composer, and populated search dialog
fit without horizontal overflow; the search dialog remains fully visible.

## Council replacement

- Migrated Grug, Architect, and Designer with full original personas and exact
  provider, model, and reasoning settings. Their schedules remain off. Verified
  the migration twice: no duplicate bots or channels. The private backup retains
  all 14 previous sessions, member configuration, and Council settings.
- All three answered a real, bounded channel-design question through their
  configured providers. Live QA found that bot spawning did not mark provider
  selections explicit; fixed it and verified both Pi members and Codex Architect.
  Dispatch failures now retain their original error instead of hiding the cause.
- Architect used native tools to discover Quinn, create a new channel, send a brief,
  read it, and check request status. Quinn replied in that channel. The test channel
  was archived afterward; the migrated Council channel remains available.
- Verified agent attribution and work links in the live transcript, compact member
  stack/menu, all three real advisor responses, and the Council channel in the sidebar.
- Removed Council from the installed application, package tree, collection manifest,
  dependency lockfile, and screenshot definitions. Its history backup remains local.
- Added regression coverage for tool discovery, forged identity rejection, safe send
  and create retries, channel membership access, creator membership, per-caller
  reactions, cross-channel limits, bounded mention fan-out, errors/PASS/cancellation,
  retry status, and bot CLI ownership of private documents and work.
- Independent read-only review completed with no remaining major findings after
  the CLI ownership fix. The expanded suite has **75 passing tests**.

## Smart responses and inline images

Verified on 2026-09-20 in `Chat polish QA` with Atlas and a temporary QA Channel
Guide. The QA bot has no scheduled work; existing bot profiles and missions were
preserved.

- Smart selected Atlas alone for a fact-check question and selected nobody for
  “Thanks, that is all.” Atlas answered in one sentence.
- Directed was selected in the live menu and persisted through the CLI. An ordinary
  message produced no jobs. Replying to QA Channel Guide without an @mention
  targeted that bot alone. Switching back to Smart restored the new-channel default.
- Temporarily made the primary routing provider unavailable. The configured Codex
  fallback selected QA Channel Guide for a grammar question; it answered concisely.
  Restored the primary Pi provider afterward. Hidden routing sessions were cleaned up.
- A real clipboard paste containing PNG bytes and text showed a loaded draft preview,
  kept the caption, and sent an inline image. Expansion opened the original with a
  Download action. A real bot called `bots_publish_image`; its final response contained
  the image and caption together, without a second channel message. Both displayed
  at the original 2:1 aspect ratio.
- The bot used `bots_react` to add 👍 and finished with `[PASS]`. The reaction appeared
  with the bot's name, with no public text reply. A later reply correctly recognized
  the shared image as four color swatches.
- Added regression coverage for Directed/reply/@all routing, asynchronous Smart
  subset/silence, idempotent sends, failure/retry, archive/delete cancellation,
  provider-specific reasoning/permissions and fallback cleanup, byte-based media
  classification, workspace containment, image-only replies, and default settings.
- Independent review caught workspace containment, deletion cancellation, and
  host-specific provider lookup issues; all were fixed. **85 Bots tests pass**,
  along with full workspace typecheck, test suites, and build.

Live screenshots: [inline images](../assets/channel-images.png) and
[chat mode beneath the composer](../assets/channel-behavior.png). Restore the archived QA channel
before rerunning `BB_CAPTURE_ONLY=bots-images,bots-behavior` captures. Its bot is
retired after verification, with workspace and history preserved.
