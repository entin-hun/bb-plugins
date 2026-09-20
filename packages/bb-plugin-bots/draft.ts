import type { Attachment, RoomMessage } from "./contract";

export type Draft = {
  text: string;
  attachments: Attachment[];
  reply: RoomMessage | null;
  request: { fingerprint: string; id: string } | null;
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export const emptyDraft = (): Draft => ({
  text: "",
  attachments: [],
  reply: null,
  request: null,
});
export function readDraft(storage: Storage, key: string): Draft {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (
      value &&
      typeof value.text === "string" &&
      Array.isArray(value.attachments)
    )
      return { ...emptyDraft(), ...value };
  } catch {}
  return emptyDraft();
}
// Persist synchronously before the RPC: an accepted send may lose its response.
export function prepareSend(
  storage: Storage,
  key: string,
  roomId: string,
  draft: Draft,
) {
  const payload = {
    id: roomId,
    text: draft.text.trim(),
    attachmentIds: draft.attachments.map((a) => a.id),
    replyTo: draft.reply?.id ?? null,
  };
  const fingerprint = JSON.stringify(payload);
  const request =
    draft.request?.fingerprint === fingerprint
      ? draft.request
      : { fingerprint, id: crypto.randomUUID() };
  const next = { ...draft, request };
  storage.setItem(key, JSON.stringify(next));
  return { draft: next, payload: { ...payload, requestId: request.id } };
}

// A previous mount's accepted request must not erase text entered after navigation.
export function clearSentDraft(
  storage: Storage,
  key: string,
  sent: Draft,
): boolean {
  const current = readDraft(storage, key);
  const content = (draft: Draft) =>
    JSON.stringify([
      draft.text,
      draft.attachments.map((a) => a.id),
      draft.reply?.id ?? null,
    ]);
  if (
    current.request?.id !== sent.request?.id ||
    content(current) !== content(sent)
  )
    return false;
  storage.setItem(key, JSON.stringify(emptyDraft()));
  return true;
}
