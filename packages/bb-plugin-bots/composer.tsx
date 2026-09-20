import { useEffect, useRef, useState, useId, type ReactNode } from "react";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import type { Bot, RoomMessage, rpcContract } from "./contract";
import { Button } from "./components/ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "./components/ui/coarse-pointer-sizing";
import { BotOptions, matchingBots } from "./channel-controls";
import { ChannelAttachments } from "./channel-attachments";
import { emptyDraft, readDraft, prepareSend, clearSentDraft } from "./draft";

const errorText = (e: unknown) => {
  if (e instanceof DOMException && e.name === "NotAllowedError")
    return "Allow microphone access to dictate a message.";
  return (e instanceof Error ? e.message : String(e)).replace(
    /^(HTTP \d+: )+/,
    "",
  );
};
const encode = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
export function GroupComposer({
  autoFocus = false,
  roomId,
  roomName,
  paused,
  reply,
  onClearReply,
  insertion,
  onInserted,
  onSent,
  bots,
  memberIds,
  onCreateBot,
  footer,
}: {
  footer?: ReactNode;
  autoFocus?: boolean;
  bots: Bot[];
  memberIds: string[];
  onCreateBot: () => void;
  roomId: string;
  roomName: string;
  paused: boolean;
  reply: RoomMessage | null;
  onClearReply: () => void;
  insertion: { text: string; nonce: number; replaceMention?: boolean } | null;
  onInserted: () => void;
  onSent: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>(),
    key = `bb:bots:draft:${roomId}`;
  const [draft, setDraft] = useState(() => readDraft(localStorage, key)),
    [pending, setPending] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false),
    [voice, setVoice] = useState<
      "idle" | "starting" | "recording" | "transcribing"
    >("idle");
  const editor = useRef<HTMLTextAreaElement>(null),
    picker = useRef<HTMLInputElement>(null),
    recording = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true),
    sending = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();
  const [mention, setMention] = useState<{
      start: number;
      end: number;
      query: string;
    } | null>(null),
    [selection, setSelection] = useState(0);
  const creatingMention = useRef<{ start: number; end: number } | null>(null);
  const options = mention ? matchingBots(bots, memberIds, mention.query) : [];
  const findMention = (text: string, caret: number) => {
    const match = text.slice(0, caret).match(/(?:^|[\s(])@([a-z0-9_-]*)$/i);
    setMention(
      match
        ? { start: caret - match[1]!.length - 1, end: caret, query: match[1]! }
        : null,
    );
    setSelection(0);
  };
  const insertMention = (bot: Bot) => {
    if (!mention) return;
    const text = `@${bot.handle} `;
    setDraft((d) => ({
      ...d,
      text: d.text.slice(0, mention.start) + text + d.text.slice(mention.end),
    }));
    const caret = mention.start + text.length;
    setMention(null);
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(caret, caret);
    });
  };
  const createMention = () => {
    creatingMention.current = mention;
    setMention(null);
    onCreateBot();
  };
  const blocked = paused || pending || uploading || voice !== "idle";
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
    } catch {}
  }, [key, draft]);
  useEffect(() => {
    alive.current = true;
    rpc.call("composer").then(
      (c) => setVoiceEnabled(c.voiceEnabled),
      () => {},
    );
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recording.current?.state === "recording") recording.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, [rpc]);
  useEffect(() => {
    if (insertion) {
      const range = insertion.replaceMention ? creatingMention.current : null;
      setDraft((d) => ({
        ...d,
        text: range
          ? d.text.slice(0, range.start) +
            insertion.text +
            d.text.slice(range.end)
          : `${d.text}${d.text && !d.text.endsWith(" ") ? " " : ""}${insertion.text}`,
      }));
      creatingMention.current = null;
      setMention(null);
      onInserted();
      editor.current?.focus();
    }
  }, [insertion]);
  useEffect(() => {
    if (reply) {
      setDraft((d) => ({ ...d, reply }));
      onClearReply();
      editor.current?.focus();
    }
  }, [reply]);
  useEffect(() => {
    const el = editor.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(220, Math.max(68, el.scrollHeight))}px`;
    }
  }, [draft.text]);
  const attach = async (files: File[]) => {
    if (blocked || !files.length) return;
    setError(null);
    if (draft.attachments.length + files.length > 10) {
      setError("Attach up to 10 files per message.");
      return;
    }
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024)
          throw new Error(`${file.name} exceeds 8 MB.`);
        const a = await rpc.call("upload", {
          id: roomId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          data: await encode(file),
        });
        if (alive.current)
          setDraft((d) => ({
            ...d,
            attachments: [...d.attachments.filter((x) => x.id !== a.id), a],
          }));
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setUploading(false);
    }
  };
  const send = async () => {
    if (
      sending.current ||
      blocked ||
      (!draft.text.trim() && !draft.attachments.length)
    )
      return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      const prepared = prepareSend(localStorage, key, roomId, draft);
      setDraft(prepared.draft);
      await rpc.call("send", prepared.payload);
      const cleared = clearSentDraft(localStorage, key, prepared.draft);
      if (alive.current) {
        if (cleared) setDraft(emptyDraft());
        onClearReply();
        onSent();
        editor.current?.focus();
      }
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      sending.current = false;
      if (alive.current) setPending(false);
    }
  };
  const dictate = async () => {
    if (voice === "recording") {
      recording.current?.stop();
      return;
    }
    if (blocked || !voiceEnabled) return;
    setError(null);
    setVoice("starting");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Dictation needs microphone access in a supported browser.",
        );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: localStorage.getItem("bb.voiceInput.audioInputDeviceId")
          ? {
              deviceId: {
                ideal: localStorage.getItem(
                  "bb.voiceInput.audioInputDeviceId",
                )!,
              },
            }
          : true,
      });
      if (!alive.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(
        media,
        mime ? { mimeType: mime } : undefined,
      );
      recording.current = recorder;
      const chunks: Blob[] = [];
      let failed = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onerror = () => {
        failed = true;
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach((t) => t.stop());
        if (alive.current) {
          setVoice("idle");
          setError("Microphone recording failed. Try again.");
        }
      };
      recorder.onstop = async () => {
        if (timer.current) clearTimeout(timer.current);
        if (!failed) media.getTracks().forEach((t) => t.stop());
        recording.current = null;
        stream.current = null;
        if (!alive.current || failed) return;
        setVoice("transcribing");
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (blob.size > 5 * 1024 * 1024)
            throw new Error("Recording exceeds 5 MB. Try a shorter message.");
          const result = await rpc.call("transcribe", {
            data: await encode(blob),
            mimeType: blob.type,
            prompt: draft.text,
          });
          if (alive.current) {
            setDraft((d) => ({
              ...d,
              text: `${d.text}${d.text ? " " : ""}${result.text}`,
            }));
            editor.current?.focus();
          }
        } catch (e) {
          if (alive.current) setError(errorText(e));
        } finally {
          if (alive.current) setVoice("idle");
        }
      };
      recorder.start();
      setVoice("recording");
      timer.current = setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 120000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(errorText(e));
      setVoice("idle");
    }
  };
  return (
    <div className="group-compose-wrap">
      {mention && !blocked && (
        <div className="channel-mention-picker">
          <BotOptions
            bots={bots}
            memberIds={memberIds}
            query={mention.query}
            selected={Math.min(selection, options.length)}
            listId={listId}
            onHover={setSelection}
            onSelect={insertMention}
            onCreate={createMention}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="bot-compose-error">
          {error}
        </p>
      )}
      <div
        className="group-compose group/promptbox relative w-full rounded-xl border border-border bg-background shadow-lift"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            void attach(Array.from(e.dataTransfer.files));
          }
        }}
      >
        {draft.reply && (
          <div className="group-reply-preview">
            <Icon name="CornerDownRight" />
            <span>
              <strong>Replying to {draft.reply.speaker}</strong>
              <span>{draft.reply.text.slice(0, 150) || "Attachment"}</span>
            </span>
            <button
              aria-label="Cancel reply"
              onClick={() => setDraft((d) => ({ ...d, reply: null }))}
            >
              <Icon name="X" />
            </button>
          </div>
        )}
        {!!draft.attachments.length && (
          <ChannelAttachments
            attachments={draft.attachments}
            disabled={pending}
            onRemove={async (a) => {
              if (sending.current || blocked) return;
              setUploading(true);
              try {
                await rpc.call("discardAttachment", {
                  id: roomId,
                  attachmentId: a.id,
                });
                if (alive.current)
                  setDraft((d) => ({
                    ...d,
                    attachments: d.attachments.filter((x) => x.id !== a.id),
                  }));
              } catch (e) {
                if (alive.current) setError(errorText(e));
              } finally {
                if (alive.current) setUploading(false);
              }
            }}
          />
        )}
        <textarea
          ref={editor}
          autoFocus={autoFocus}
          aria-label="Message channel"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={!!mention && !blocked}
          aria-controls={mention ? listId : undefined}
          aria-activedescendant={
            mention
              ? `${listId}-${Math.min(selection, options.length)}`
              : undefined
          }
          placeholder={paused ? "Channel archived" : `Message #${roomName}…`}
          value={draft.text}
          maxLength={16000}
          disabled={paused || pending}
          rows={1}
          onChange={(e) => {
            setDraft((d) => ({ ...d, text: e.target.value }));
            findMention(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) =>
            findMention(e.currentTarget.value, e.currentTarget.selectionStart)
          }
          onBlur={(e) => {
            if (!e.relatedTarget?.closest(".channel-mention-picker"))
              setMention(null);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              if (text && !blocked && !sending.current) {
                const { selectionStart, selectionEnd } = e.currentTarget;
                setDraft((d) => ({
                  ...d,
                  text: (
                    d.text.slice(0, selectionStart) +
                    text +
                    d.text.slice(selectionEnd)
                  ).slice(0, 16000),
                }));
              }
              void attach(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (mention && !blocked) {
              if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSelection(
                  (value) =>
                    (value + (e.key === "ArrowDown" ? 1 : options.length)) %
                    (options.length + 1),
                );
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault();
                const bot = options[Math.min(selection, options.length)];
                if (bot) insertMention(bot);
                else createMention();
                return;
              }
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="group-compose-controls">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            aria-label="Choose attachments"
            onChange={(e) => {
              void attach(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 max-md:pointer-coarse:h-10 max-md:pointer-coarse:w-10"
            aria-label="Attach files"
            disabled={blocked}
            onClick={() => picker.current?.click()}
          >
            <Icon name="Plus" />
          </Button>
          <span className="group-compose-hint" role="status">
            {uploading
              ? "Uploading…"
              : voice === "recording"
                ? "Listening…"
                : voice === "transcribing"
                  ? "Transcribing…"
                  : voice === "starting"
                    ? "Opening microphone…"
                    : ""}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 max-md:pointer-coarse:h-10 max-md:pointer-coarse:w-10 ${voice === "recording" ? "is-recording" : ""}`}
            aria-label={
              voice === "recording"
                ? "Finish dictation"
                : voiceEnabled
                  ? "Dictate message"
                  : "Dictate message (enable voice transcription in BB settings)"
            }
            disabled={
              !voiceEnabled ||
              paused ||
              pending ||
              uploading ||
              ["starting", "transcribing"].includes(voice)
            }
            onClick={() => void dictate()}
          >
            <Icon name={voice === "recording" ? "Square" : "Mic"} />
          </Button>
          <Button
            size="icon"
            className="h-8 w-8 max-md:pointer-coarse:h-10 max-md:pointer-coarse:w-10"
            aria-label="Send message"
            disabled={
              blocked || (!draft.text.trim() && !draft.attachments.length)
            }
            onClick={() => void send()}
          >
            <Icon name="CornerDownLeft" />
          </Button>
        </div>
      </div>
      {footer && <div className="group-compose-footer">{footer}</div>}
    </div>
  );
}
