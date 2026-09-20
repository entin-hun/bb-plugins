# Bots and Channels verification

Verified in the running BB application on 2026-09-20 using isolated QA Echo,
QA Review, and a QA channel. Existing owner bots and channels were preserved.

## Baseline

- New channel opens directly into an empty, focused composer.
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
