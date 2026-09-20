import { createHash, randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  Attachment,
  Bot,
  Conversation,
  Job,
  Room,
  RoomMessage,
  RoomRun,
} from "./contract";
import { Store } from "./store";
export const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
const missingThread = (cause: unknown) =>
  /(?:^|\b)(?:thread not found|thread does not exist|HTTP 404)(?:\b|$)/i.test(
    errorText(cause),
  );
export function mentioned(text: string, handle: string) {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^a-zA-Z0-9_.-])@${escaped}(?![a-zA-Z0-9_.-])`,
    "i",
  ).test(text);
}
export function recipients(text: string, members: Bot[]) {
  const selected = members
    .filter((b) => mentioned(text, b.handle))
    .map((b) => b.id);
  return mentioned(text, "all") ||
    mentioned(text, "everyone") ||
    !selected.length
    ? members.map((b) => b.id)
    : selected;
}
export const jobPrompt = (job: Job) =>
  `Read MISSION.md and MEMORY.md before acting.\n\n${job.text}\n\nRequest: ${job.id}`;
export type MessageAuthor = {
  botId: string | null;
  speaker: string;
  sourceThreadId: string;
  depth: number;
};
export class Runtime {
  private locks = new Map<string, Promise<unknown>>();
  readonly busy = new Map<string, { threadId: string; at: number }>();
  readonly abort = new AbortController();
  constructor(
    readonly bb: BbPluginApi,
    readonly store: Store,
  ) {}
  changed() {
    this.bb.realtime.publish("changed", {});
  }
  async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  async conversation(
    bot: Bot,
    key: string,
    kind: Conversation["kind"],
    title: string,
    prompt?: string,
    attachments: Attachment[] = [],
  ): Promise<Conversation> {
    if (bot.retired) throw new Error("Restore this bot before starting work.");
    const existing = this.store
      .conversations(bot.id)
      .find((c) => c.key === key);
    if (existing) return existing;
    const thread = await this.bb.sdk.threads.spawn({
      projectId: bot.projectId,
      environment: {
        type: "host",
        hostId: bot.hostId,
        workspace: { type: "unmanaged", path: bot.home },
      },
      input: [
        {
          type: "text",
          text:
            prompt ??
            "Read MISSION.md and MEMORY.md. Introduce yourself in one short sentence based on your mission. Then wait for a message.",
          mentions: [],
        },
        ...attachments.map((a) =>
          a.type === "localImage"
            ? { type: "localImage" as const, path: a.path }
            : {
                type: "localFile" as const,
                path: a.path,
                name: a.name,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
              },
        ),
      ],
      sendAt: Date.now() + 1500,
      title: `${bot.name} · ${title}`,
      visibility: "hidden",
      providerId: bot.providerId,
      ...(bot.model ? { model: bot.model } : {}),
      reasoningLevel: bot.reasoningLevel,
      executionInputSources: {
        providerId: "explicit",
        ...(bot.model ? { model: "explicit" as const } : {}),
        reasoningLevel: "explicit",
      },
      permissionMode: bot.permissionMode,
      pluginMetadata: { botId: bot.id, conversationKey: key },
    });
    const c: Conversation = {
      id: randomUUID(),
      botId: bot.id,
      key,
      threadId: thread.id,
      title,
      kind,
      createdAt: Date.now(),
    };
    this.store.putConversation(c);
    if (bot.error) this.store.put({ ...this.store.get(bot.id), error: null });
    this.changed();
    return c;
  }
  enqueue(
    bot: Bot,
    args: Partial<Job> & Pick<Job, "id" | "text" | "conversationKey">,
  ) {
    const now = Date.now();
    return this.store.enqueue({
      botId: bot.id,
      threadId: null,
      status: "queued",
      reply: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      dispatchStartedAt: null,
      roomId: null,
      runId: null,
      triggerMessageId: null,
      depth: 0,
      attachments: [],
      ...args,
    });
  }
  wake(bot: Bot) {
    if (bot.retired) throw new Error("Restore this bot before waking it.");
    if (bot.paused) throw new Error("Resume this bot before waking it.");
    if (this.store.work(bot.id).some((j) => j.conversationKey === "mission"))
      return false;
    const queued = this.enqueue(bot, {
      id: randomUUID(),
      conversationKey: "mission",
      text: "Review MISSION.md and MEMORY.md. Take one useful, bounded step toward your mission. Record progress and unfinished work in MEMORY.md. If blocked or there is nothing useful to do, say so and stop.",
    });
    this.store.put({ ...bot, lastWakeAt: Date.now() });
    this.changed();
    return queued;
  }
  send(
    room: Room,
    text: string,
    requestId: string,
    attachments: Attachment[] = [],
    replyTo: string | null = null,
    author?: MessageAuthor,
  ): RoomMessage {
    const existing = this.store.message(requestId);
    if (existing) {
      if (
        existing.roomId !== room.id ||
        existing.botId !== (author?.botId ?? null) ||
        existing.sourceThreadId !== author?.sourceThreadId ||
        existing.text !== text ||
        existing.replyTo !== replyTo ||
        JSON.stringify(existing.attachments.map((a) => a.id)) !==
          JSON.stringify(attachments.map((a) => a.id))
      )
        throw new Error(
          "Message request ID was already used for different content.",
        );
      return existing;
    }
    if (!text.trim() && !attachments.length)
      throw new Error("Write a message or attach a file.");
    if (room.archived)
      throw new Error("Restore this channel before sending a message.");
    if (replyTo && this.store.message(replyTo)?.roomId !== room.id)
      throw new Error("Reply message not found in this group.");
    if (
      author?.botId &&
      (
        this.store.db
          .prepare(
            "SELECT COUNT(*) AS n FROM room_messages WHERE json_extract(json,'$.sourceThreadId')=?",
          )
          .get(author.sourceThreadId) as { n: number }
      ).n >= 3
    )
      throw new Error(
        "This response has already sent three consultation messages. Summarize the results before requesting more work.",
      );
    if (author && author.depth > 2)
      throw new Error(
        "Bot consultation handoff limit reached. Return your findings to the requesting channel.",
      );
    // Explicit sends may invite new bots. This is committed with the message,
    // so editing a draft or retrying a lost response cannot change membership.
    if (
      this.store.all().some((bot) => bot.retired && mentioned(text, bot.handle))
    )
      throw new Error("Restore the retired bot before mentioning it.");
    const invited = this.store
      .all()
      .filter((bot) => !bot.retired && mentioned(text, bot.handle));
    room = {
      ...room,
      memberIds: [...new Set([...room.memberIds, ...invited.map((b) => b.id)])],
    };
    if (room.memberIds.length > 16)
      throw new Error("A channel can have up to 16 bots.");
    const now = Date.now();
    const run: RoomRun = {
      id: requestId,
      roomId: room.id,
      status: "running",
      mode: "concurrent",
      pendingJobIds: [],
      settledJobIds: [],
      round: 1,
      remaining: [],
      next: [],
      jobId: null,
      createdAt: now,
      error: null,
    };
    const m: RoomMessage = {
      id: requestId,
      roomId: room.id,
      runId: run.id,
      botId: author?.botId ?? null,
      speaker: author?.speaker ?? "You",
      ...(author ? { sourceThreadId: author.sourceThreadId } : {}),
      text,
      createdAt: now,
      attachments,
      replyTo,
    };
    this.store.db.transaction(() => {
      this.store.putMessage(m);
      this.store.claimAttachments(attachments.map((a) => a.id));
      for (const botId of recipients(
        text,
        room.memberIds.map((id) => this.store.get(id)),
      ))
        if (botId !== author?.botId)
          this.invite(room, run, m, botId, author?.depth ?? 0);
      if (!run.pendingJobIds.length) run.status = "done";
      this.store.putRun(run);
      this.store.putRoom({ ...room, updatedAt: now });
    })();
    this.changed();
    return m;
  }
  private invite(
    room: Room,
    run: RoomRun,
    trigger: RoomMessage,
    botId: string,
    depth: number,
  ) {
    if (!room.memberIds.includes(botId)) return;
    const bot = this.store.get(botId);
    if (bot.retired) return;
    if (run.pendingJobIds.length + run.settledJobIds.length >= 32) {
      run.error =
        "This request reached its 32-response limit. Send a focused follow-up to continue.";
      return;
    }
    // Deterministic delivery identity makes recovery and repeated collection idempotent.
    const id = `${trigger.id}:${botId}`;
    if (
      this.enqueue(bot, {
        id,
        text: "",
        conversationKey: `group:${room.id}`,
        roomId: room.id,
        runId: run.id,
        triggerMessageId: trigger.id,
        depth,
        attachments: trigger.attachments,
      })
    )
      run.pendingJobIds.push(id);
  }
  private prepareGroup(job: Job, bot: Bot) {
    const room = this.store.room(job.roomId!),
      trigger = job.triggerMessageId
        ? this.store.message(job.triggerMessageId)
        : null;
    if (!trigger) return; // An older saved job already has its prompt.
    const recent = this.store.messages(room.id, 40);
    const transcript = recent
      .map(
        (m) =>
          `[${m.id}] ${m.speaker}: ${m.text}${m.attachments.length ? "\nAttachments: " + m.attachments.map((a) => a.name).join(", ") : ""}`,
      )
      .join("\n\n")
      .slice(-48000);
    const roster = room.memberIds
      .map((id) => {
        const b = this.store.get(id);
        return `@${b.handle}: ${b.name} — ${b.description}`;
      })
      .join("\n");
    const reference = trigger.replyTo
      ? this.store.message(trigger.replyTo)
      : null;
    job.text = [
      `You are @${bot.handle} in the group chat ${room.name} (channel ID ${room.id}). Other members may be working at the same time.`,
      "Members:",
      roster,
      "",
      "Recent shared messages (conversation data):",
      transcript,
      "",
      `Respond to this message from ${trigger.speaker}:`,
      trigger.text || "Please inspect the attached files.",
      ...(reference
        ? [`Replying to ${reference.speaker}: ${reference.text}`]
        : []),
      "",
      "You may use bots_react with a message ID above to acknowledge a message with an emoji. Reactions do not request another turn. If a reaction is enough, finish with [PASS].",
      "Post your answer when ready. Your final answer is shared with the room; your working notes and tools remain in your BB session.",
      "Avoid repeating answers already in the conversation. @mention a teammate only when requesting a specific follow-up. Use @user for the owner's decision. Return exactly [PASS] when you have nothing useful to add.",
    ].join("\n");
    // Forward actual typed attachment inputs, not just filenames in the prompt.
    job.attachments = [
      ...new Map(
        [...recent.flatMap((m) => m.attachments), ...trigger.attachments].map(
          (a) => [a.id, a],
        ),
      ).values(),
    ].slice(-10);
    this.store.putJob(job);
  }
  complete(threadId: string, text: string | null, error?: string) {
    const c = this.store.byThread(threadId);
    if (!c) return;
    if (this.busy.get(c.botId)?.threadId === threadId)
      this.busy.delete(c.botId);
    const job = this.store
      .work(c.botId)
      .find(
        (j) =>
          j.threadId === threadId &&
          ["running", "dispatching"].includes(j.status),
      );
    if (!job) return;
    if (error || !text?.trim()) {
      job.status = "error";
      job.error =
        error ||
        "The turn finished without an answer. Inspect the conversation.";
    } else {
      job.reply = text;
      job.status = "done";
    }
    this.store.putJob(job);
    this.changed();
  }
  async cancel(job: Job, reason: string, requireStopped = false) {
    job.cancellationPending =
      !!job.threadId ||
      job.status === "dispatching" ||
      !!job.cancellationPending;
    job.status = "cancelled";
    job.error = reason;
    this.store.putJob(job);
    if (job.threadId) {
      try {
        const queued = await this.bb.sdk.threads.queuedMessages.list({
          threadId: job.threadId,
        });
        for (const entry of queued)
          await this.bb.sdk.threads.queuedMessages.delete({
            threadId: job.threadId,
            queuedMessageId: entry.id,
          });
        await this.bb.sdk.threads.stop({ threadId: job.threadId });
      } catch (cause) {
        if (!missingThread(cause)) throw cause;
      }
      job.cancellationPending = false;
      this.store.putJob(job);
      if (this.busy.get(job.botId)?.threadId === job.threadId)
        this.busy.delete(job.botId);
    }
    if (requireStopped && this.store.job(job.id)?.cancellationPending)
      throw new Error(
        "Still locating a cancelled response. Try again after automatic cleanup finishes.",
      );
    this.changed();
  }
  async stopRoom(room: Room) {
    // Publish answers that already finished before archiving/cancelling pending work.
    await this.driveRoom(room);
    room = this.store.room(room.id);
    const next = { ...room, paused: false, updatedAt: Date.now() };
    this.store.putRoom(next);
    // Keep the run and roster retryable until host cleanup succeeds.
    for (const bot of this.store.all())
      await this.locked(bot.id, async () => {
        for (const job of this.store.work(bot.id))
          if (job.roomId === room.id)
            await this.cancel(job, "Channel archived by the owner.", true);
      });
    for (const run of this.store.runs(room.id))
      if (run.status === "queued" || run.status === "running") {
        run.status = "stopped";
        run.remaining = [];
        run.next = [];
        this.store.putRun(run);
      }
    this.changed();
    return next;
  }
  async retire(id: string, retired: boolean): Promise<Bot> {
    return this.locked("rooms", async () => {
      const roomIds = this.store
        .rooms()
        .map((r) => r.id)
        .sort();
      const lockRooms = async (i: number): Promise<Bot> => {
        if (i < roomIds.length)
          return this.locked(`room:${roomIds[i]}`, () => lockRooms(i + 1));
        return this.locked(id, async () => {
          const bot = this.store.get(id);
          if (!!bot.retired === retired) return bot;
          if (retired) {
            for (const job of this.store.work(id))
              await this.cancel(job, "Bot retired by the owner.", true);
            for (const c of this.store
              .conversations(id)
              .filter((c) => c.kind === "admin")) {
              try {
                for (const q of await this.bb.sdk.threads.queuedMessages.list({
                  threadId: c.threadId,
                }))
                  await this.bb.sdk.threads.queuedMessages.delete({
                    threadId: c.threadId,
                    queuedMessageId: q.id,
                  });
                await this.bb.sdk.threads.stop({ threadId: c.threadId });
              } catch (cause) {
                if (!missingThread(cause)) throw cause;
              }
            }
          }
          const next = {
            ...bot,
            retired,
            paused: true,
            updatedAt: Math.max(Date.now(), bot.updatedAt + 1),
          };
          this.store.db.transaction(() => {
            this.store.put(next);
            if (retired)
              for (const room of this.store.rooms())
                if (room.memberIds.includes(id))
                  this.store.putRoom({
                    ...room,
                    memberIds: room.memberIds.filter((b) => b !== id),
                    updatedAt: Date.now(),
                  });
          })();
          this.busy.delete(id);
          this.changed();
          return next;
        });
      };
      return lockRooms(0);
    });
  }
  async retryJob(id: string): Promise<Job> {
    const original = this.store.job(id);
    if (!original?.roomId)
      throw new Error("Only channel responses can be retried.");
    return this.locked(`room:${original.roomId}`, async () => {
      const job = this.store.job(id);
      if (!job?.roomId)
        throw new Error("This response is no longer available.");
      const room = this.store.room(job.roomId);
      if (room.archived)
        throw new Error("Restore this channel before retrying.");
      const bot = this.store.get(job.botId);
      if (bot.retired || !room.memberIds.includes(bot.id))
        throw new Error("Invite this bot before retrying.");
      if (
        !["error", "cancelled"].includes(job.status) ||
        job.cancellationPending
      )
        throw new Error("Wait for this response to stop before retrying.");
      const retryId = `retry:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
      const existing = this.store.job(retryId);
      if (existing) return existing;
      const run = this.store.runs(room.id).find((r) => r.id === job.runId);
      if (!run) throw new Error("The original discussion was not found.");
      this.store.db.transaction(() => {
        this.enqueue(bot, {
          id: retryId,
          retryOf: id,
          text: job.text,
          conversationKey: job.conversationKey,
          roomId: room.id,
          runId: run.id,
          triggerMessageId: job.triggerMessageId,
          depth: job.depth,
          attachments: job.attachments,
        });
        this.store.putRun({
          ...run,
          status: "running",
          pendingJobIds: [...run.pendingJobIds, retryId],
        });
      })();
      this.changed();
      return this.store.job(retryId)!;
    });
  }
  async deleteRoom(id: string): Promise<boolean> {
    return this.locked(`room:${id}`, async () => {
      if (!this.store.findRoom(id)) return false;
      // Wait for in-flight dispatches to finish registering their threads. Use
      // a stable lock order so simultaneous deletions cannot deadlock.
      const botIds = [
        ...new Set(this.store.roomJobs(id, -1).map((j) => j.botId)),
      ].sort();
      const remove = async (index: number): Promise<boolean> => {
        if (index < botIds.length)
          return this.locked(botIds[index]!, () => remove(index + 1));
        const jobs = this.store.roomJobs(id, -1);
        if (jobs.some((j) => j.status === "dispatching" && !j.threadId))
          throw new Error(
            "A bot response is still being located. Check channel activity and try deleting again.",
          );
        for (const job of jobs) {
          // Retry interrupted cancellation too; don't delete the record until
          // BB confirms its queued input and active turn have both stopped.
          if (!["done", "error"].includes(job.status))
            await this.cancel(job, "Channel deleted by the owner.");
          if (this.store.job(job.id)?.cancellationPending)
            throw new Error(
              "Still locating a cancelled response. Try deleting again after cleanup finishes.",
            );
        }
        const deleted = this.store.deleteRoom(id);
        this.changed();
        return deleted;
      };
      return remove(0);
    });
  }
  async driveRoom(room: Room) {
    if (room.archived) return;
    const runs = this.store
      .runs(room.id)
      .filter((r) => r.status === "queued" || r.status === "running");
    let changed = false;
    this.store.db.transaction(() => {
      for (const run of runs) {
        // Adopt unfinished discussions saved by the original sequential scheduler.
        if (run.mode !== "concurrent") {
          const trigger = this.store.message(run.id);
          run.pendingJobIds = run.jobId ? [run.jobId] : [];
          run.settledJobIds = [];
          run.mode = "concurrent";
          if (trigger)
            for (const id of [...new Set([...run.remaining, ...run.next])])
              this.invite(room, run, trigger, id, 0);
          run.remaining = [];
          run.next = [];
          run.jobId = null;
          changed = true;
        }
      }
      // Collect across discussions: the room follows completion order, not send order.
      const completed = runs
        .flatMap((run) =>
          run.pendingJobIds.flatMap((id) => {
            const job = this.store.job(id);
            return job && ["done", "error", "cancelled"].includes(job.status)
              ? [{ run, job }]
              : [];
          }),
        )
        .sort((a, b) => a.job.updatedAt - b.job.updatedAt);
      for (const { run, job } of completed) {
        changed = true;
        run.pendingJobIds = run.pendingJobIds.filter((id) => id !== job.id);
        if (run.settledJobIds.includes(job.id)) continue;
        run.settledJobIds.push(job.id);
        if (job.error) run.error = job.error;
        if (
          job.status !== "done" ||
          !room.memberIds.includes(job.botId) ||
          !job.reply ||
          job.reply.trim() === "[PASS]"
        )
          continue;
        const bot = this.store.get(job.botId);
        const reply: RoomMessage = {
          id: job.id,
          roomId: room.id,
          runId: run.id,
          botId: bot.id,
          speaker: bot.name,
          text: job.reply,
          createdAt: job.updatedAt,
          replyTo: job.triggerMessageId,
          attachments: [],
        };
        if (this.store.putMessage(reply)) {
          const currentRoom = this.store.room(room.id);
          this.store.putRoom({
            ...currentRoom,
            updatedAt: Math.max(currentRoom.updatedAt + 1, Date.now()),
          });
        }
        if (job.depth < 2)
          for (const id of room.memberIds)
            if (
              id !== bot.id &&
              mentioned(job.reply, this.store.get(id).handle)
            )
              this.invite(room, run, reply, id, job.depth + 1);
      }
      for (const run of runs) {
        run.status = run.pendingJobIds.length ? "running" : "done";
        this.store.putRun(run);
      }
    })();
    if (changed) this.changed();
  }
  async reconcileBusy(bot: Bot) {
    const busy = this.busy.get(bot.id);
    if (busy && Date.now() - busy.at < 5000) return;
    const threadIds = new Set([
      ...this.store
        .conversations(bot.id)
        .filter((c) => c.kind === "admin")
        .map((c) => c.threadId),
      ...this.store
        .work(bot.id)
        .flatMap((j) => (j.threadId ? [j.threadId] : [])),
    ]);
    for (const threadId of threadIds) {
      let thread;
      try {
        thread = await this.bb.sdk.threads.get({ threadId });
      } catch (cause) {
        if (!missingThread(cause)) throw cause;
        this.complete(threadId, null, "The work conversation was deleted.");
        this.store.db
          .prepare("DELETE FROM conversations WHERE thread_id=?")
          .run(threadId);
        continue;
      }
      if (thread.status === "active") {
        this.busy.set(bot.id, { threadId, at: Date.now() });
        return;
      }
    }
    this.busy.delete(bot.id);
  }
  async drive(bot: Bot) {
    const job = this.store
      .work(bot.id)
      .find((job) => job.cancellationPending || !bot.paused || !!job.roomId);
    if (!job) return;
    if (job.cancellationPending && job.threadId) {
      await this.cancel(job, job.error ?? "Cancelled by the owner.");
      return;
    }
    if (
      (job.status === "dispatching" || job.status === "running") &&
      job.threadId
    ) {
      const thread = await this.bb.sdk.threads.get({ threadId: job.threadId });
      // Every automatic job has its own thread. Its output cannot
      // belong to an earlier job, even if an active/idle event was missed.
      const queued = await this.bb.sdk.threads.queuedMessages.list({
        threadId: job.threadId,
      });
      const current = this.store.job(job.id)!;
      if (!["dispatching", "running"].includes(current.status)) return;
      current.dispatchStartedAt ??= current.updatedAt;
      const matching = queued.some((entry) =>
        entry.content.some(
          (block) => block.type === "text" && block.text === jobPrompt(job),
        ),
      );
      if (thread.status === "error")
        this.complete(
          job.threadId,
          null,
          "The agent turn failed. Inspect the conversation.",
        );
      else if (thread.status === "active" || matching) {
        current.status = "running";
        if (thread.status === "active" && !current.startedAt)
          current.startedAt = Date.now();
        this.store.putJob(current);
      } else if (thread.status === "idle") {
        const output = (
          await this.bb.sdk.threads.output({ threadId: job.threadId })
        ).output;
        if (output?.trim()) this.complete(job.threadId, output);
        else if (job.status === "dispatching")
          this.complete(
            job.threadId,
            null,
            "Dispatch outcome is unknown. Inspect the conversation before sending again.",
          );
      } else if (job.status === "dispatching")
        this.complete(
          job.threadId,
          null,
          "Dispatch outcome is unknown. Inspect the conversation before sending again.",
        );
      const latest = this.store.job(job.id)!;
      if (
        ["dispatching", "running"].includes(latest.status) &&
        Date.now() -
          (latest.startedAt ?? latest.dispatchStartedAt ?? latest.updatedAt) >
          20 * 60000
      )
        await this.cancel(
          latest,
          "Turn timed out after 20 minutes. Inspect the conversation before retrying.",
        );
      return;
    }
    if (job.status === "dispatching" || job.cancellationPending) {
      for (let offset = 0; ; offset += 100) {
        const threads = await this.bb.sdk.threads.list({
          projectId: bot.projectId,
          originPluginId: "bots",
          includeHidden: true,
          limit: 100,
          offset,
        });
        for (const thread of threads) {
          const metadata = await this.bb.sdk.threads.getPluginMetadata({
            threadId: thread.id,
          });
          if (
            metadata.botId !== bot.id ||
            metadata.conversationKey !== `${job.conversationKey}:${job.id}`
          )
            continue;
          if (!this.store.byThread(thread.id))
            this.store.putConversation({
              id: randomUUID(),
              botId: bot.id,
              key: `${job.conversationKey}:${job.id}`,
              threadId: thread.id,
              title: job.roomId ? this.store.room(job.roomId).name : "Mission",
              kind: job.roomId ? "group" : "mission",
              createdAt: job.createdAt,
            });
          const current = this.store.job(job.id)!;
          current.threadId = thread.id;
          this.store.putJob(current);
          if (current.status === "cancelled")
            await this.cancel(
              current,
              current.error ?? "Cancelled by the owner.",
            );
          this.changed();
          return;
        }
        if (threads.length < 100) break;
      }
      const current = this.store.job(job.id)!;
      if (current.cancellationPending)
        throw new Error(
          "Still locating a cancelled response. Host cleanup will retry automatically.",
        );
      if (current.status === "dispatching") {
        current.status = "error";
        current.error = [
          "Dispatch outcome is unknown. Inspect the conversation before sending again.",
          current.error,
        ]
          .filter(Boolean)
          .join(" ");
        this.store.putJob(current);
        this.changed();
      }
      return;
    }
    if (this.busy.has(bot.id)) return;
    const recent = this.store.db
      .prepare(
        "SELECT count(*) AS n FROM jobs WHERE bot_id=? AND json_extract(json,'$.startedAt')>?",
      )
      .get(bot.id, Date.now() - 3600000) as { n: number };
    if (recent.n >= 30)
      throw new Error(
        "Hourly limit reached (30 automatic turns). Queued work will resume later.",
      );
    if (job.roomId) this.prepareGroup(job, bot);
    job.status = "dispatching";
    job.dispatchStartedAt = Date.now();
    this.store.putJob(job);
    try {
      const c = await this.conversation(
        bot,
        `${job.conversationKey}:${job.id}`,
        job.roomId ? "group" : "mission",
        job.roomId ? this.store.room(job.roomId).name : "Mission",
        jobPrompt(job),
        job.attachments,
      );
      const current = this.store.job(job.id)!;
      current.threadId = c.threadId;
      if (current.status === "dispatching") current.status = "running";
      this.store.putJob(current);
      if (current.status === "cancelled")
        await this.cancel(current, current.error ?? "Cancelled by the owner.");
    } catch (cause) {
      const current = this.store.job(job.id)!;
      if (current.status === "dispatching") {
        current.error = `Checking dispatch after: ${errorText(cause)}`;
        this.store.putJob(current);
      }
      this.busy.delete(bot.id);
    }
    this.changed();
  }
  async tick() {
    for (const room of this.store.rooms())
      await this.locked(`room:${room.id}`, async () => {
        const current = this.store.findRoom(room.id);
        if (current) await this.driveRoom(current);
      });
    for (const initial of this.store.all()) {
      if (this.abort.signal.aborted) return;
      await this.locked(initial.id, async () => {
        const bot = this.store.get(initial.id);
        try {
          await this.reconcileBusy(bot);
          if (
            !bot.retired &&
            !bot.paused &&
            bot.intervalMinutes &&
            Date.now() - bot.lastWakeAt >= bot.intervalMinutes * 60000
          )
            this.wake(bot);
          await this.drive(bot);
          if (bot.error) {
            this.store.put({ ...this.store.get(bot.id), error: null });
            this.changed();
          }
        } catch (cause) {
          const error = errorText(cause);
          if (bot.error !== error) {
            this.store.put({ ...this.store.get(bot.id), error });
            this.changed();
          }
        }
      });
    }
  }
  async dispose() {
    this.abort.abort();
    await Promise.allSettled(this.locks.values());
  }
}
