import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createFakePluginHost,
  makeThreadResponse,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import type { PluginCliContext } from "@get-bb/plugin-sdk";
import {
  botSchema,
  roomSchema,
  messageSchema,
  attachmentSchema,
  jobSchema,
} from "../contract";
import { Store } from "../store";
import plugin from "../server";

async function setup() {
  const files = new Map<string, Buffer>();
  const host = createFakePluginHost({
    pluginId: "bots",
    agentSkillIds: ["bots"],
    sdk: {
      system: {
        config: async () => ({
          primaryHostId: "host_primary",
          voiceTranscriptionEnabled: true,
        }),
        transcribeVoice: async () => ({ text: "Transcribed words" }),
      },
      projects: {
        create: async () => ({ id: "proj_bots" }),
        attachments: {
          upload: async ({ filename }) => ({
            path: `stored/${filename}`,
            name: filename,
            type: "localFile",
            sizeBytes: 5,
            mimeType: "text/plain",
          }),
          read: async () => ({
            bytes: Buffer.from("hello"),
            mimeType: "text/plain",
          }),
        },
      },
      threads: {
        get: async () => makeThreadResponse({ environmentId: "env_remote" }),
        update: async () => makeThreadResponse(),
        stop: async () => ({ ok: true }),
        queuedMessages: {
          list: async () => [],
          delete: async () => ({ ok: true }),
        },
      },
      environments: { get: async () => ({ hostId: "host_remote" }) },
      files: {
        read: async ({ hostId, path }) => {
          const bytes = files.get(`${hostId}:${path}`);
          if (!bytes) throw new Error("File not found");
          return {
            path,
            content: bytes.toString("base64"),
            contentEncoding: "base64",
            sizeBytes: bytes.length,
            sha256: "version",
            mimeType: "text/plain",
          };
        },
        write: async ({
          hostId,
          path,
          content,
          contentEncoding,
          expectedSha256,
        }) => {
          const key = `${hostId}:${path}`;
          if (expectedSha256 === null && files.has(key))
            return { outcome: "conflict", currentSha256: "existing" };
          const bytes = Buffer.from(content, contentEncoding ?? "utf8");
          files.set(key, bytes);
          return {
            outcome: "written",
            sha256: "saved",
            sizeBytes: bytes.length,
          };
        },
      },
    },
  });
  await plugin(host.bb);
  const run = (args: string[], ctx: PluginCliContext = {}) =>
    host.harness.behavior.runCli(args, ctx);
  const ok = async (args: string[], ctx: PluginCliContext = {}) => {
    const result = await run([...args, "--json"], ctx);
    assert.equal(result.exitCode, 0, result.stderr);
    return JSON.parse(result.stdout) as unknown;
  };
  const create = async (name = "Atlas") =>
    botSchema.parse(
      await ok([
        "create",
        name,
        "--mission",
        "Verify facts.",
        "--model",
        "model-a",
        "--reasoning",
        "low",
      ]),
    );
  return {
    ...host,
    files,
    run,
    ok,
    create,
    store: new Store(host.bb.storage.database()),
    close: () => host.harness.lifecycle.dispose(),
  };
}

test("CLI creates and patches profiles, preserves fields, and exposes its skill", async () => {
  const x = await setup();
  try {
    const b = await x.create();
    assert.equal(b.paused, true);
    assert.match((await x.run(["mission", "@atlas"])).stdout, /Verify facts/);
    const updated = botSchema.parse(
      await x.ok([
        "update",
        "@atlas",
        "--description",
        "Researcher",
        "--interval",
        "15",
      ]),
    );
    assert.equal(updated.model, "model-a");
    assert.equal(updated.reasoningLevel, "low");
    assert.equal(updated.intervalMinutes, 15);
    assert.equal(
      botSchema.parse(await x.ok(["show", b.id])).description,
      "Researcher",
    );
    const changed = await x.run(["update", b.id, "--provider", "different"]);
    assert.notEqual(changed.exitCode, 0);
    assert.equal(x.store.get(b.id).providerId, "codex");
    const invalid = await x.run(["update", b.id, "--interval", "-1"]);
    assert.equal(invalid.exitCode, 2);
    await x.create("Atlas");
    const ambiguous = await x.run(["show", "ATLAS"]);
    assert.equal(ambiguous.exitCode, 2);
    assert.match(ambiguous.stderr, /ambiguous/);
    assert.equal(botSchema.parse(await x.ok(["show", "@atlas"])).id, b.id);
    const config = await x.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    assert.deepEqual(config.skills, ["bots"]);
  } finally {
    await x.close();
  }
});

test("CLI propagates default-model reasoning and clearing a model to existing work threads", async () => {
  const x = await setup();
  try {
    const bot = botSchema.parse(
      await x.ok(["create", "Default", "--mission", "Review facts"]),
    );
    x.store.putConversation({
      id: "conversation",
      botId: bot.id,
      key: "admin",
      threadId: "thr_existing",
      title: "Bot chat",
      kind: "admin",
      createdAt: 1,
    });
    await x.ok(["update", bot.id, "--reasoning", "high"]);
    assert.deepEqual(
      x.harness.inspection.sdk.callsTo("threads.update").at(-1)?.[0],
      { threadId: "thr_existing", model: null, reasoningLevel: "high" },
    );
    await x.ok(["update", bot.id, "--model", "model-b"]);
    await x.ok(["update", bot.id, "--model", ""]);
    assert.deepEqual(
      x.harness.inspection.sdk.callsTo("threads.update").at(-1)?.[0],
      { threadId: "thr_existing", model: null, reasoningLevel: "high" },
    );
    assert.equal(x.store.get(bot.id).model, "");
  } finally {
    await x.close();
  }
});

test("CLI mission and memory writes preserve version conflicts and remote file identity", async () => {
  const x = await setup();
  try {
    const b = await x.create();
    const initial = (await x.ok(["memory", b.id])) as {
      text: string;
      version: string;
    };
    x.files.set(
      "host_remote:/repo/memory.md",
      Buffer.from("Remember ORBIT-42."),
    );
    await x.ok(
      ["memory", b.id, "--file", "memory.md", "--version", initial.version],
      { threadId: "thr_remote", cwd: "/repo" },
    );
    const stale = await x.run([
      "memory",
      b.id,
      "--text",
      "Stale edit",
      "--version",
      initial.version,
    ]);
    assert.equal(stale.exitCode, 1);
    assert.match(stale.stderr, /changed/);
    assert.equal((await x.run(["memory", b.id])).stdout, "Remember ORBIT-42.");
    const read = x.harness.inspection.sdk.callsTo("files.read").at(-1)!;
    assert.deepEqual(read[0], {
      hostId: "host_remote",
      path: "/repo/memory.md",
      signal: undefined,
    });
    const conflict = await x.run([
      "mission",
      b.id,
      "--text",
      "one",
      "--file",
      "two",
    ]);
    assert.equal(conflict.exitCode, 2);
    const noHost = await x.run(["mission", b.id, "--file", "/tmp/mission.md"]);
    assert.equal(noHost.exitCode, 2);
    assert.match(noHost.stderr, /--machine/);
  } finally {
    await x.close();
  }
});

test("CLI manages channel membership and lifecycle without overwriting unrelated members", async () => {
  const x = await setup();
  try {
    const a = await x.create(),
      b = await x.create("Scribe");
    const room = roomSchema.parse(
      await x.ok(["channel", "create", "Launch room", "--bot", "@atlas"]),
    );
    await Promise.all([
      x.ok(["channel", "invite", room.id, "@scribe"]),
      x.ok(["channel", "rename", room.id, "Launch"]),
    ]);
    const current = roomSchema.parse(await x.ok(["channel", "show", "Launch"]));
    assert.deepEqual(new Set(current.memberIds), new Set([a.id, b.id]));
    assert.equal(
      ((await x.ok(["channel", "members", "Launch"])) as unknown[]).length,
      2,
    );
    await x.ok(["channel", "remove", "Launch", "@scribe"]);
    await x.ok(["channel", "pin", "Launch"]);
    assert.equal(x.store.room(room.id).pinned, true);
    await x.ok(["channel", "unpin", "Launch"]);
    assert.equal(x.store.room(room.id).pinned, false);
    await x.ok(["channel", "archive", "Launch"]);
    assert.equal(
      ((await x.ok(["channel", "list"])) as { channels: unknown[] }).channels
        .length,
      0,
    );
    assert.equal(
      (
        (await x.ok(["channel", "list", "--archived"])) as {
          channels: unknown[];
        }
      ).channels.length,
      1,
    );
    assert.notEqual(
      (await x.run(["channel", "send", "Launch", "--text", "blocked"]))
        .exitCode,
      0,
    );
    await x.ok(["channel", "restore", "Launch"]);
    const newBot = botSchema.parse(
      await x.ok([
        "create",
        "Quinn",
        "--mission",
        "Review wording",
        "--channel",
        "Launch",
      ]),
    );
    assert.ok(x.store.room(room.id).memberIds.includes(newBot.id));
    const unnamed = roomSchema.parse(await x.ok(["channel", "create"]));
    assert.equal(unnamed.name, "New channel");
  } finally {
    await x.close();
  }
});

test("CLI deletion requires confirmation, removes archived channels, and preserves bots", async () => {
  const x = await setup();
  try {
    const bot = await x.create();
    const room = roomSchema.parse(
      await x.ok(["channel", "create", "Delete test", "--bot", bot.id]),
    );
    const refused = await x.run(["channel", "delete", room.id]);
    assert.notEqual(refused.exitCode, 0);
    assert.match(refused.stderr, /--yes/);
    assert.ok(x.store.findRoom(room.id));
    await x.ok(["channel", "archive", room.id]);
    assert.deepEqual(await x.ok(["channel", "delete", room.id, "--yes"]), {
      deleted: true,
    });
    assert.equal(x.store.findRoom(room.id), null);
    assert.equal(x.store.get(bot.id).id, bot.id);
  } finally {
    await x.close();
  }
});

test("CLI messages, replies, retries, reactions, and history pages share UI rules", async () => {
  const x = await setup();
  try {
    const room = roomSchema.parse(await x.ok(["channel", "create", "Notes"]));
    const id = randomUUID();
    const first = messageSchema.parse(
      await x.ok([
        "channel",
        "send",
        "Notes",
        "--text",
        "First",
        "--request-id",
        id,
      ]),
    );
    await x.ok([
      "channel",
      "send",
      "Notes",
      "--text",
      "First",
      "--request-id",
      id,
    ]);
    assert.equal(x.store.messages(room.id).length, 1);
    assert.notEqual(
      (
        await x.run([
          "channel",
          "send",
          "Notes",
          "--text",
          "Changed",
          "--request-id",
          id,
        ])
      ).exitCode,
      0,
    );
    const second = messageSchema.parse(
      await x.ok([
        "channel",
        "send",
        "Notes",
        "--text",
        "Second",
        "--reply-to",
        first.id,
      ]),
    );
    assert.equal(second.replyTo, first.id);
    await x.ok(["channel", "react", "Notes", first.id, "✅"]);
    await x.ok(["channel", "react", "Notes", first.id, "✅"]);
    assert.equal(x.store.reactions(room.id).length, 1);
    const older = (await x.ok([
      "channel",
      "messages",
      "Notes",
      "--limit",
      "1",
      "--offset",
      "1",
    ])) as { messages: unknown[]; reactions: unknown[] };
    assert.equal(messageSchema.parse(older.messages[0]).text, "First");
    assert.equal(older.reactions.length, 1);
    await x.ok(["channel", "react", "Notes", first.id, "✅", "--remove"]);
    assert.equal(x.store.reactions(room.id).length, 0);
    await x.ok(["channel", "read", "Notes"]);
    assert.equal(
      x.store.room(room.id).lastReadAt,
      x.store.room(room.id).updatedAt,
    );
    const other = roomSchema.parse(await x.ok(["channel", "create", "Other"]));
    assert.notEqual(
      (await x.run(["channel", "react", other.id, first.id, "👍"])).exitCode,
      0,
    );
    assert.notEqual(
      (
        await x.run([
          "channel",
          "send",
          other.id,
          "--text",
          "Wrong reply",
          "--reply-to",
          first.id,
        ])
      ).exitCode,
      0,
    );
    const b = await x.create();
    await x.ok(["channel", "send", "Notes", "--text", "@atlas please review"]);
    assert.ok(x.store.room(room.id).memberIds.includes(b.id));
  } finally {
    await x.close();
  }
});

test("CLI attachments use the invoking machine, support downloads, and protect destination files", async () => {
  const x = await setup();
  try {
    const room = roomSchema.parse(await x.ok(["channel", "create", "Files"]));
    x.files.set("host_remote:/repo/brief.txt", Buffer.from("hello"));
    const ctx = { threadId: "thr_remote", cwd: "/repo" };
    const attachment = attachmentSchema.parse(
      await x.ok(["channel", "attach", "Files", "brief.txt"], ctx),
    );
    await x.ok(
      ["channel", "download", "Files", attachment.id, "--out", "copy.txt"],
      ctx,
    );
    assert.equal(
      x.files.get("host_remote:/repo/copy.txt")?.toString(),
      "hello",
    );
    assert.equal(
      (
        await x.run(
          ["channel", "download", "Files", attachment.id, "--out", "copy.txt"],
          ctx,
        )
      ).exitCode,
      2,
    );
    await x.ok(
      [
        "channel",
        "download",
        "Files",
        attachment.id,
        "--out",
        "copy.txt",
        "--force",
      ],
      ctx,
    );
    const message = messageSchema.parse(
      await x.ok(
        ["channel", "send", "Files", "--attachment", attachment.id],
        ctx,
      ),
    );
    assert.equal(message.attachments.length, 1);
    const retry = messageSchema.parse(
      await x.ok(
        [
          "channel",
          "send",
          "Files",
          "--attach",
          "brief.txt",
          "--request-id",
          message.id,
        ],
        ctx,
      ),
    );
    assert.equal(retry.id, message.id);
    await x.ok([
      "channel",
      "download",
      room.id,
      attachment.id,
      "--out",
      "/copy.txt",
      "--machine",
      "host_elsewhere",
    ]);
    assert.equal(x.files.get("host_elsewhere:/copy.txt")?.toString(), "hello");
    const draft = attachmentSchema.parse(
      await x.ok([
        "channel",
        "attach",
        "Files",
        "/repo/brief.txt",
        "--machine",
        "host_remote",
        "--mime-type",
        "application/octet-stream",
      ]),
    );
    await x.ok(["channel", "discard", "Files", draft.id]);
    assert.throws(() => x.store.attachment(draft.id));
    assert.notEqual(
      (
        await x.run([
          "channel",
          "attach",
          "Files",
          "relative.txt",
          "--machine",
          "host_remote",
        ])
      ).exitCode,
      0,
    );
    assert.equal(
      (
        (await x.ok([
          "transcribe",
          "/repo/brief.txt",
          "--machine",
          "host_remote",
        ])) as { text: string }
      ).text,
      "Transcribed words",
    );
  } finally {
    await x.close();
  }
});

test("CLI activity and per-response stop preserve the channel and separate mission pauses", async () => {
  const x = await setup();
  try {
    const b = await x.create();
    await x.ok(["resume", b.id]);
    await x.ok(["wake", b.id]);
    const room = roomSchema.parse(
      await x.ok([
        "channel",
        "create",
        "Work",
        "--bot",
        b.id,
        "--behavior",
        "everyone",
      ]),
    );
    await x.ok(["channel", "send", "Work", "--text", "Please help"]);
    await x.ok(["pause", b.id]);
    assert.ok(x.store.work(b.id).every((j) => j.roomId === room.id));
    const data = (await x.ok([
      "activity",
      "--bot",
      "@atlas",
      "--channel",
      "Work",
    ])) as { jobs: unknown[] };
    const job = jobSchema.parse(data.jobs[0]);
    assert.equal(jobSchema.parse(await x.ok(["job", job.id])).id, job.id);
    assert.deepEqual(await x.ok(["stop", job.id]), { cancelled: true });
    assert.deepEqual(await x.ok(["stop", job.id]), { cancelled: false });
    await x.ok(["channel", "send", "Work", "--text", "Still usable"]);
    assert.equal(x.store.work(b.id).length, 1);
    assert.equal((await x.run(["wake", b.id])).exitCode, 1);
  } finally {
    await x.close();
  }
});

test("CLI large history pages fail within the output cap and can be paged smaller", async () => {
  const x = await setup();
  try {
    const room = roomSchema.parse(await x.ok(["channel", "create", "History"]));
    for (let i = 0; i < 12; i++) {
      const id = randomUUID();
      x.store.putMessage({
        id,
        runId: id,
        roomId: room.id,
        botId: null,
        speaker: "You",
        replyTo: null,
        attachments: [],
        text: "\u0001".repeat(16000),
        createdAt: i,
      });
    }
    const large = await x.run(["channel", "messages", room.id, "--json"]);
    assert.equal(large.exitCode, 2);
    assert.match(large.stderr, /Reduce --limit/);
    const page = (await x.ok([
      "channel",
      "messages",
      room.id,
      "--limit",
      "1",
    ])) as { messages: unknown[]; nextOffset: number };
    assert.equal(page.messages.length, 1);
    assert.equal(page.nextOffset, 1);
  } finally {
    await x.close();
  }
});

test("CLI help, invalid flags, bounds, and aborted calls do not mutate state", async () => {
  const x = await setup();
  try {
    assert.match((await x.run(["--help"])).stdout, /channel create/);
    assert.match((await x.run(["channel", "--help"])).stdout, /channel send/);
    for (const args of [
      ["nonsense"],
      ["channel", "create", "X", "--unknown"],
      ["create", "Missing"],
      ["list", "--limit", "101"],
      ["list", "--offset", "-1"],
      ["channel", "list", "--all", "--archived"],
    ]) {
      const result = await x.run([...args, "--json"]);
      assert.equal(result.exitCode, 2, result.stdout);
      assert.ok(JSON.parse(result.stderr).error);
    }
    const controller = new AbortController();
    controller.abort();
    assert.notEqual(
      (
        await x.run(["channel", "create", "Nope"], {
          signal: controller.signal,
        })
      ).exitCode,
      0,
    );
    assert.equal(x.store.rooms().length, 0);
    assert.equal(x.store.all().length, 0);
  } finally {
    await x.close();
  }
});

test("CLI retirement, restoration, and searching retained channel history", async () => {
  const x = await setup();
  try {
    const b = await x.create("History bot");
    const room = roomSchema.parse(await x.ok(["channel", "create", "History"]));
    for (let i = 0; i < 4; i++)
      await x.ok([
        "channel",
        "send",
        room.id,
        "--text",
        `Searchable fixture ${i}`,
      ]);
    const page = (await x.ok([
      "channel",
      "search",
      room.id,
      "fixture",
      "--limit",
      "2",
    ])) as { messages: unknown[]; nextBefore: string };
    assert.equal(page.messages.length, 2);
    assert.ok(page.nextBefore);
    const next = (await x.ok([
      "channel",
      "search",
      room.id,
      "fixture",
      "--before",
      page.nextBefore,
    ])) as { messages: unknown[]; nextBefore: null };
    assert.equal(next.messages.length, 2);
    assert.equal(next.nextBefore, null);
    await x.ok(["retire", b.id]);
    assert.equal(
      ((await x.ok(["list"])) as { bots: unknown[] }).bots.length,
      0,
    );
    assert.equal(
      ((await x.ok(["list", "--retired"])) as { bots: unknown[] }).bots.length,
      1,
    );
    await x.ok(["restore", b.id]);
    assert.equal(
      ((await x.ok(["list"])) as { bots: unknown[] }).bots.length,
      1,
    );
  } finally {
    await x.close();
  }
});

test("filtered bot list pagination counts only visible bots", async () => {
  const x = await setup();
  try {
    const b = await x.create("Visible");
    for (let i = 0; i < 60; i++)
      x.store.put({
        ...b,
        id: `bot_${i.toString(16).padStart(16, "0")}`,
        handle: `retired-${i}`,
        retired: true,
      });
    const active = (await x.ok(["list"])) as {
      bots: unknown[];
      nextOffset: number | null;
    };
    assert.equal(active.bots.length, 1);
    assert.equal(active.nextOffset, null);
    const retired = (await x.ok(["list", "--retired"])) as {
      bots: unknown[];
      nextOffset: number;
    };
    assert.equal(retired.bots.length, 50);
    assert.equal(retired.nextOffset, 50);
    assert.equal((await x.run(["list", "--retired", "--all"])).exitCode, 2);
  } finally {
    await x.close();
  }
});

test("CLI agent sends preserve caller identity and expose consultation status", async () => {
  const x = await setup();
  try {
    const b = await x.create();
    const requestId = randomUUID();
    const args = [
      "channel",
      "create",
      "Review",
      "--bot",
      b.id,
      "--request-id",
      requestId,
    ];
    const room = roomSchema.parse(await x.ok(args));
    assert.equal(roomSchema.parse(await x.ok(args)).id, room.id);
    const m = messageSchema.parse(
      await x.ok(["channel", "send", room.id, "--text", "@all Review this"], {
        threadId: "thr_agent",
      }),
    );
    assert.equal(m.speaker, "BB agent");
    assert.equal(m.sourceThreadId, "thr_agent");
    const status = (await x.ok(["channel", "request", room.id, m.id])) as {
      complete: boolean;
      total: number;
    };
    assert.equal(status.complete, false);
    assert.equal(status.total, 1);
    assert.notEqual(
      (await x.run(["channel", "request", room.id, "missing"])).exitCode,
      0,
    );
  } finally {
    await x.close();
  }
});

test("bot CLI callers cannot inspect or administer another bot's private state", async () => {
  const x = await setup();
  try {
    const a = await x.create("Alpha"),
      b = await x.create("Beta");
    const room = roomSchema.parse(
      await x.ok(["channel", "create", "Private Beta", "--bot", b.id]),
    );
    const message = messageSchema.parse(
      await x.ok(["channel", "send", room.id, "--text", "@all Private brief"]),
    );
    const job = x.store.requestJobs(message.id)[0]!;
    x.store.putConversation({
      id: "alpha-admin",
      botId: a.id,
      key: "admin",
      kind: "admin",
      threadId: "thr_alpha",
      title: "Alpha",
      createdAt: Date.now(),
    });
    const ctx = { threadId: "thr_alpha" };
    const activity = (await x.ok(["activity"], ctx)) as { jobs: unknown[] };
    assert.deepEqual(activity.jobs, []);
    for (const args of [
      ["activity", "--bot", b.id],
      ["activity", "--channel", room.id],
      ["job", job.id],
      ["stop", job.id],
      ["retry", job.id],
      ["memory", b.id],
      ["mission", b.id],
      ["memory", b.id, "--text", "Overwrite"],
      ["update", b.id, "--description", "Change"],
      ["retire", b.id],
      ["channel", "messages", room.id],
    ])
      assert.notEqual((await x.run(args, ctx)).exitCode, 0, args.join(" "));
    assert.equal(x.store.job(job.id)?.status, "queued");
    assert.equal(x.store.get(b.id).retired, undefined);
    assert.equal((await x.run(["mission", a.id], ctx)).exitCode, 0);
  } finally {
    await x.close();
  }
});

test("CLI response behavior validates modes and remembers the owner's choice", async () => {
  const x = await setup();
  try {
    const first = roomSchema.parse(await x.ok(["channel", "create", "First"]));
    assert.equal(first.responseBehavior, "smart");
    await x.ok(["channel", "behavior", first.id, "directed"]);
    assert.deepEqual(await x.ok(["channel", "behavior", first.id]), {
      responseBehavior: "directed",
    });
    assert.equal(
      roomSchema.parse(await x.ok(["channel", "create", "Second"]))
        .responseBehavior,
      "directed",
    );
    assert.notEqual(
      (await x.run(["channel", "behavior", first.id, "invalid"])).exitCode,
      0,
    );
    assert.equal(
      roomSchema.parse(
        await x.ok(["channel", "create", "Review", "--behavior", "everyone"]),
      ).responseBehavior,
      "everyone",
    );
  } finally {
    await x.close();
  }
});
