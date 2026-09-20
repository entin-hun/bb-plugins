import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBbNavigate,
  useRealtime,
  useRpc,
  Markdown,
  experimental_Icon as Icon,
  type PluginNavPanelProps,
  type PluginThreadListProps,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import type {
  Bot,
  Room,
  RoomMessage,
  Reaction,
  Job,
  RoomRun,
  rpcContract,
} from "./contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "./components/ui/context-menu";
import { ProfileForm, WorkList, ErrorMessage, message } from "./bot-ui";
import { channelWork } from "./channel-work";
import { GroupComposer } from "./composer";
import { Menu, Modal, InvitePicker, ReactionPicker } from "./channel-controls";

const uuid = /^[a-f0-9-]{36}$/;
const channelId = (subPath: string) =>
  uuid.test(subPath.split("/")[0] ?? "") ? subPath.split("/")[0]! : null;
function useRoster() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<{ bots: Bot[]; rooms: Room[] }>({
    bots: [],
    rooms: [],
  });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("list").then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(message(e)),
    );
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime("changed", load);
  return { ...data, error, load };
}
type ChannelData = {
  room: Room;
  messages: RoomMessage[];
  reactions: Reaction[];
  jobs: Job[];
  runs: RoomRun[];
};
function useChannel(id: string | null) {
  const rpc = useRpc<typeof rpcContract>(),
    request = useRef(0);
  const [data, setData] = useState<ChannelData | null>(null),
    [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    const seq = ++request.current;
    if (!id) {
      setData(null);
      return;
    }
    rpc.call("room", { id }).then(
      (d) => {
        if (seq === request.current) {
          setData(d);
          setError(null);
        }
      },
      (e) => {
        if (seq === request.current) {
          setError(message(e));
          // Do not leave a deleted channel's transcript and composer on screen.
          if (message(e).includes("Channel not found")) setData(null);
        }
      },
    );
  }, [rpc, id]);
  useEffect(() => {
    setData(null);
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useRealtime("changed", load);
  return { data: data?.room.id === id ? data : null, error, load };
}
export function ChannelRedirect({ subPath }: { subPath?: string }) {
  const navigate = useBbNavigate();
  useEffect(
    () =>
      navigate.toPluginPanel("channels", {
        subPath: subPath ?? "new",
        replace: true,
      }),
    [navigate, subPath],
  );
  return null;
}
export function ChannelsNavigation(props: ExperimentalSidebarNavigationProps) {
  const [expanded, setExpanded] = useState(false);
  const channel = props.items.find(
    (item) =>
      item.action.kind === "open-plugin-panel" &&
      item.action.pluginId === "bots" &&
      item.action.panelId === "channels",
  );
  const rest = props.items.filter((item) => item !== channel);
  const ordered = channel ? [rest[0]!, channel, ...rest.slice(1)] : rest;
  const visible = expanded ? ordered : ordered.slice(0, 10);
  return (
    <nav className="channels-navigation" aria-label="Main navigation">
      {visible.map((item) => {
        const icon =
          item === channel
            ? "MessageSquare"
            : item.icon.kind === "plugin"
              ? item.icon.icon || "Puzzle"
              : {
                  "new-thread": "MessageCirclePlus",
                  search: "Search",
                  extensions: "Puzzle",
                }[item.icon.name];
        return (
          <button
            key={item.id}
            {...item.experimental_splitProps}
            className="channel-nav-row"
            disabled={item.isDisabled}
            aria-current={
              item !== channel && props.activeItemId === item.id
                ? "page"
                : undefined
            }
            aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
            onClick={(e) =>
              props.experimental_activate(item.id, {
                openInSplit: e.metaKey || e.ctrlKey,
              })
            }
          >
            <Icon name={icon} />
            <span>{item === channel ? "New channel" : item.label}</span>
          </button>
        );
      })}
      {ordered.length > 10 && (
        <button
          className="channel-nav-row"
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name="MoreHorizontal" />
          {expanded ? "Less" : "More"}
        </button>
      )}
    </nav>
  );
}
export function ChannelsSidebar({
  Original,
  onNavigate,
  activeThreadId,
}: PluginThreadListProps) {
  const { rooms, error } = useRoster(),
    rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [searching, setSearching] = useState(false),
    [archived, setArchived] = useState(false),
    [renaming, setRenaming] = useState<Room | null>(null),
    [deleting, setDeleting] = useState<Room | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const archive = async (room: Room) => {
    setPending(true);
    setFailure(null);
    try {
      await rpc.call("channelState", { id: room.id, archived: !room.archived });
    } catch (e) {
      setFailure(message(e));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    const listener = (e: Event) =>
      setSelected((e as CustomEvent<string | null>).detail);
    window.addEventListener("bots:channel-selection", listener);
    return () => window.removeEventListener("bots:channel-selection", listener);
  }, []);
  useEffect(() => {
    if (activeThreadId) setSelected(null);
  }, [activeThreadId]);
  const open = (id: string) => {
    setSelected(id);
    navigate.toPluginPanel("channels", { subPath: id });
    onNavigate();
  };
  const list = rooms
    .filter(
      (r) =>
        !!r.archived === archived &&
        r.name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt,
    );
  return (
    <>
      <section className="channels-sidebar" aria-label="Channels">
        <header>
          <button onClick={() => setArchived(!archived)}>
            {archived ? "Archived channels" : "Channels"}
          </button>
          <span />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search channels"
            onClick={() => setSearching(!searching)}
          >
            <Icon name="Search" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="New channel"
            onClick={() => open("new")}
          >
            <Icon name="Plus" />
          </Button>
        </header>
        {searching && (
          <Input
            autoFocus
            aria-label="Filter channels"
            placeholder="Find a channel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        {error && <ErrorMessage error={error} />}
        <ErrorMessage error={failure} />
        {list.map((r) => (
          <ContextMenu key={r.id}>
            <ContextMenuTrigger asChild>
              <button
                className={`channel-nav-row ${r.updatedAt > (r.lastReadAt ?? 0) && selected !== r.id ? "is-unread" : ""}`}
                aria-current={selected === r.id ? "page" : undefined}
                onClick={() => open(r.id)}
                onKeyDown={(event) => {
                  if (
                    event.key !== "ContextMenu" &&
                    !(event.shiftKey && event.key === "F10")
                  )
                    return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.dispatchEvent(
                    new MouseEvent("contextmenu", {
                      bubbles: true,
                      clientX: rect.left + 16,
                      clientY: rect.bottom,
                    }),
                  );
                }}
              >
                {r.pinned ? (
                  <Icon name="Pin" />
                ) : (
                  <span className="channel-hash" aria-hidden>
                    #
                  </span>
                )}
                <span>{r.name}</span>
                {r.updatedAt > (r.lastReadAt ?? 0) && selected !== r.id && (
                  <span className="channel-unread-dot" aria-label="Unread" />
                )}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent aria-label={`${r.name} options`}>
              <ContextMenuItem onSelect={() => setRenaming(r)}>
                <Icon name="Edit" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                disabled={pending}
                onSelect={() => void archive(r)}
              >
                <Icon name="Archive" />
                {r.archived ? "Restore" : "Archive"}
              </ContextMenuItem>
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleting(r)}
              >
                <Icon name="Trash2" />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        {!list.length && searching && (
          <p className="channel-menu-label">No matching channels</p>
        )}
      </section>
      {renaming && (
        <RenameChannel
          key={renaming.id}
          room={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <DeleteChannel room={deleting} onClose={() => setDeleting(null)} />
      )}
      <Original />
    </>
  );
}
function DeleteChannel({ room, onClose }: { room: Room; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Delete channel?"
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <div className="bot-form">
        <p className="text-sm leading-5">
          Permanently delete <strong>{room.name}</strong> and its messages,
          reactions, and channel activity? This stops unfinished responses. Your
          bots and their workspaces are kept. This cannot be undone.
        </p>
        <ErrorMessage error={error} />
        <div className="channel-rename-actions">
          <Button
            autoFocus
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await rpc.call("deleteRoom", { id: room.id });
                localStorage.removeItem(`bb:bots:draft:${room.id}`);
                onClose();
              } catch (e) {
                setError(message(e));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Deleting…" : "Delete channel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
function RenameChannel({ room, onClose }: { room: Room; onClose: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [name, setName] = useState(room.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Rename channel"
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <form
        className="bot-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || !name.trim()) return;
          setPending(true);
          setError(null);
          try {
            await rpc.call("updateRoom", { id: room.id, name: name.trim() });
            onClose();
          } catch (e) {
            setError(message(e));
          } finally {
            setPending(false);
          }
        }}
      >
        <Input
          autoFocus
          aria-label="Channel name"
          required
          maxLength={80}
          value={name}
          disabled={pending}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
        />
        <ErrorMessage error={error} />
        <div className="channel-rename-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function stateFor(bot: Bot, data: ChannelData) {
  const job = channelWork(data.jobs).find((j) => j.botId === bot.id);
  return job?.status === "running" && job.startedAt
    ? "Working"
    : job
      ? "Waiting"
      : bot.error
        ? "Needs attention"
        : "Idle";
}
function NewBot({
  room,
  open,
  onClose,
  onSaved,
}: {
  room: Room;
  open: boolean;
  onClose: () => void;
  onSaved?: (bot: Bot) => void;
}) {
  return (
    <Modal
      title="Create a bot"
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {open && (
        <ProfileForm
          roomId={room.id}
          onSaved={(b) => {
            onSaved?.(b);
            onClose();
          }}
          onCancel={onClose}
        />
      )}
    </Modal>
  );
}
export function ChannelsHeader({ subPath }: PluginNavPanelProps) {
  const id = channelId(subPath),
    { data, error } = useChannel(id),
    { bots } = useRoster();
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [membersOpen, setMembersOpen] = useState(false),
    [inviteOpen, setInviteOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false),
    [activityOpen, setActivityOpen] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  useEffect(() => {
    setMembersOpen(false);
    setInviteOpen(false);
    setCreateOpen(false);
    setActivityOpen(false);
    setDeleteOpen(false);
    setSettingsOpen(false);
    setFailure(null);
  }, [id]);
  if (!data) return error ? <span role="alert">{error}</span> : null;
  const { room } = data,
    members = bots.filter((b) => room.memberIds.includes(b.id));
  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setFailure(null);
    try {
      await fn();
    } catch (e) {
      setFailure(message(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="channel-header">
      <div className="channel-heading">
        <Button
          variant="ghost"
          className="channel-title"
          aria-label={`Rename channel: ${room.name}`}
          onClick={() => setSettingsOpen(true)}
        >
          <span className="channel-hash" aria-hidden>
            #
          </span>
          <span className="channel-title-name">{room.name}</span>
        </Button>
        {room.archived && <small>Archived</small>}
      </div>
      <Menu
        label="Channel members"
        open={membersOpen}
        onOpenChange={setMembersOpen}
        trigger={
          <Button
            variant="ghost"
            className="channel-avatar-stack"
            aria-label={`Channel members: ${members.length} ${members.length === 1 ? "bot" : "bots"}`}
          >
            {members.length ? (
              members.slice(0, 4).map((b) => (
                <span
                  className="channel-avatar"
                  key={b.id}
                  title={`${b.name}: ${stateFor(b, data)}`}
                >
                  {b.avatar}
                  <i
                    className={`bot-presence-dot state-${stateFor(b, data).toLowerCase().replaceAll(" ", "-")}`}
                  />
                </span>
              ))
            ) : (
              <Icon name="UserRoundPlus" />
            )}
            {members.length > 4 && (
              <span className="channel-avatar channel-overflow">
                +{members.length - 4}
              </span>
            )}
          </Button>
        }
      >
        <div className="channel-member-list">
          {members.map((b) => (
            <div className="channel-member-row" key={b.id}>
              <span className="channel-avatar" aria-hidden>
                {b.avatar}
              </span>
              <span className="channel-bot-name">
                {b.name}
                <small>@{b.handle}</small>
              </span>
              <small>
                <i
                  className={`bot-presence-dot state-${stateFor(b, data).toLowerCase()}`}
                />{" "}
                {stateFor(b, data)}
              </small>
              <Menu
                label={`${b.name} options`}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${b.name} options`}
                  >
                    <Icon name="MoreHorizontal" />
                  </Button>
                }
              >
                <button
                  className="channel-menu-row"
                  onClick={() =>
                    navigate.toPluginPanel("bots", {
                      subPath: `${b.id}/profile`,
                    })
                  }
                >
                  Configure bot
                </button>

                <button
                  className="channel-menu-row"
                  disabled={pending || !!room.archived}
                  onClick={() =>
                    void act(() =>
                      rpc.call("member", {
                        id: room.id,
                        botId: b.id,
                        present: false,
                      }),
                    )
                  }
                >
                  Remove from channel
                </button>
              </Menu>
            </div>
          ))}
        </div>
        {!members.length && (
          <p className="channel-menu-label">No bots in this channel yet.</p>
        )}
        <button
          className="channel-menu-row channel-menu-footer"
          disabled={!!room.archived}
          onClick={() => {
            setMembersOpen(false);
            setInviteOpen(true);
          }}
        >
          <Icon name="Plus" />
          Add bot
        </button>
        <ErrorMessage error={failure} />
      </Menu>
      <Menu
        label="Channel options"
        trigger={
          <Button variant="ghost" size="icon" aria-label="Channel options">
            <Icon name="MoreHorizontal" />
          </Button>
        }
      >
        <button
          className="channel-menu-row"
          onClick={() => setActivityOpen(true)}
        >
          <Icon name="Clock" />
          Activity
        </button>
        <button
          className="channel-menu-row"
          onClick={() => setSettingsOpen(true)}
        >
          <Icon name="Edit" />
          Rename channel
        </button>
        <button
          className="channel-menu-row"
          disabled={pending}
          onClick={() =>
            void act(() =>
              rpc.call("channelState", { id: room.id, pinned: !room.pinned }),
            )
          }
        >
          <Icon name="Pin" />
          {room.pinned ? "Unpin channel" : "Pin channel"}
        </button>

        <button
          className="channel-menu-row"
          disabled={pending}
          onClick={() =>
            void act(() =>
              rpc.call("channelState", {
                id: room.id,
                archived: !room.archived,
              }),
            )
          }
        >
          <Icon name="Archive" />
          {room.archived ? "Restore channel" : "Archive channel"}
        </button>
        <button
          className="channel-menu-row text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Icon name="Trash2" />
          Delete channel
        </button>
        <ErrorMessage error={failure} />
      </Menu>
      <Modal title="Add a bot" open={inviteOpen} onOpenChange={setInviteOpen}>
        <InvitePicker
          bots={bots}
          memberIds={room.memberIds}
          onSelect={(b) =>
            void act(async () => {
              await rpc.call("member", {
                id: room.id,
                botId: b.id,
                present: true,
              });
              setInviteOpen(false);
            })
          }
          onCreate={() => {
            setInviteOpen(false);
            setCreateOpen(true);
          }}
        />
        <ErrorMessage error={failure} />
      </Modal>
      <NewBot
        room={room}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <Modal
        title="Channel activity"
        open={activityOpen}
        onOpenChange={setActivityOpen}
      >
        <WorkList
          jobs={data.jobs}
          bots={bots}
          onCancel={(id) => void act(() => rpc.call("cancelJob", { id }))}
        />
        <ErrorMessage error={failure} />
      </Modal>
      {settingsOpen && (
        <RenameChannel
          key={room.id}
          room={room}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteChannel room={room} onClose={() => setDeleteOpen(false)} />
      )}
    </div>
  );
}
function CreateChannel() {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const opening = useRef<Promise<Room> | null>(null);
  const [attempt, setAttempt] = useState(0),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    // Reuse the request if React replays the effect while mounting.
    opening.current ??= rpc.call("createRoom", {
      memberIds: [],
    });
    opening.current.then(
      (room) => {
        if (active)
          navigate.toPluginPanel("channels", {
            subPath: room.id,
            replace: true,
          });
      },
      (e) => {
        if (active) setError(message(e));
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, rpc, navigate]);
  return (
    <div className="bot-page">
      {error ? (
        <>
          <ErrorMessage error={error} />
          <Button
            onClick={() => {
              opening.current = null;
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <p role="status">Opening channel…</p>
      )}
    </div>
  );
}
export function ChannelsPage({ subPath }: PluginNavPanelProps) {
  const id = channelId(subPath);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("bots:channel-selection", { detail: id }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("bots:channel-selection", { detail: null }),
      );
    };
  }, [id]);
  return id ? <ChannelChat key={id} id={id} /> : <CreateChannel />;
}
function ChannelChat({ id }: { id: string }) {
  const { data, error, load } = useChannel(id),
    { bots } = useRoster(),
    rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [reply, setReply] = useState<RoomMessage | null>(null),
    [insertion, setInsertion] = useState<{
      text: string;
      nonce: number;
      replaceMention?: boolean;
    } | null>(null),
    [createOpen, setCreateOpen] = useState(false),
    [failure, setFailure] = useState<string | null>(null),
    [copied, setCopied] = useState<string | null>(null);
  const transcript = useRef<HTMLDivElement>(null),
    atBottom = useRef(true),
    marked = useRef(0);
  useEffect(() => {
    const el = transcript.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [data?.messages.length]);
  useEffect(() => {
    if (!data || marked.current >= data.room.updatedAt) return;
    marked.current = data.room.updatedAt;
    rpc
      .call("channelState", { id, lastReadAt: data.room.updatedAt })
      .catch(() => {
        marked.current = 0;
      });
  }, [id, data?.room.updatedAt, rpc]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!error?.includes("Channel not found")) return;
    // Works for deletion from either menu, the CLI, or another BB window.
    // Never follow the /new route here: deleting must not create another room.
    let active = true;
    rpc
      .call("list")
      .then(({ rooms }) => {
        if (!active) return;
        const next = rooms
          .filter((r) => !r.archived && r.id !== id)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        localStorage.removeItem(`bb:bots:draft:${id}`);
        if (next)
          navigate.toPluginPanel("channels", {
            subPath: next.id,
            replace: true,
          });
        else navigate.toPluginPanel("bots", { replace: true });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [error, rpc, navigate, id]);
  if (!data)
    return (
      <div className="bot-page">
        <ErrorMessage error={error} />
        {!error && <p role="status">Loading channel…</p>}
      </div>
    );
  const { room, messages, reactions, jobs } = data;
  const react = async (m: RoomMessage, emoji: string) => {
    try {
      await rpc.call("reaction", {
        id,
        messageId: m.id,
        emoji,
        active: !reactions.some(
          (r) =>
            r.messageId === m.id && r.emoji === emoji && r.actorId === "user",
        ),
      });
    } catch (e) {
      setFailure(message(e));
    }
  };
  const copy = async (m: RoomMessage) => {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopied(m.id);
    } catch (e) {
      setFailure(message(e));
    }
  };
  const jump = (messageId: string) => {
    const el = document.getElementById(`channel-message-${messageId}`);
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  };
  const working = channelWork(jobs);
  return (
    <div className="bot-room">
      {(failure || error) && (
        <div className="bot-error">
          <ErrorMessage error={failure || error} />
        </div>
      )}
      <div
        ref={transcript}
        className="bot-room-messages"
        role="log"
        aria-label="Channel conversation"
        aria-live="polite"
        onScroll={() => {
          const el = transcript.current;
          if (el)
            atBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
        {!messages.length && (
          <div className="channel-empty">
            <span className="channel-hash" aria-hidden>
              #
            </span>
            <h2>{room.name}</h2>
            <p>Use @ to invite a bot and start the conversation.</p>
          </div>
        )}
        {messages.map((m, i) => {
          const bot = bots.find((b) => b.id === m.botId),
            previous = messages[i - 1];
          const day = new Date(m.createdAt).toLocaleDateString(),
            newDay =
              !previous ||
              new Date(previous.createdAt).toLocaleDateString() !== day;
          const compact =
            !newDay &&
            previous?.botId === m.botId &&
            m.createdAt - previous.createdAt < 5 * 60000 &&
            !m.replyTo;
          const parent = m.replyTo
              ? messages.find((x) => x.id === m.replyTo)
              : null,
            job = jobs.find((j) => j.id === m.id);
          const grouped = [
            ...new Set(
              reactions.filter((r) => r.messageId === m.id).map((r) => r.emoji),
            ),
          ];
          return (
            <div key={m.id}>
              {newDay && (
                <div className="channel-date">
                  <span>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                    }).format(m.createdAt)}
                  </span>
                </div>
              )}
              <article
                id={`channel-message-${m.id}`}
                className={`bot-room-message ${compact ? "is-continuation" : ""}`}
                tabIndex={0}
              >
                <span className="bot-message-avatar" aria-hidden>
                  {compact ? "" : (bot?.avatar ?? <Icon name="UserRound" />)}
                </span>
                <div className="bot-message-body">
                  {!compact && (
                    <header>
                      <strong>{bot?.name ?? m.speaker}</strong>
                      <time
                        dateTime={new Date(m.createdAt).toISOString()}
                        title={new Date(m.createdAt).toLocaleString()}
                      >
                        {new Intl.DateTimeFormat(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(m.createdAt)}
                      </time>
                    </header>
                  )}
                  {parent && (
                    <button
                      className="bot-message-reference"
                      onClick={() => jump(parent.id)}
                    >
                      <Icon name="CornerDownRight" />
                      <span>
                        {parent.speaker}:{" "}
                        {parent.text.slice(0, 160) || "Attachment"}
                      </span>
                    </button>
                  )}
                  {m.text && (
                    <Markdown
                      className="bot-message-markdown text-sm leading-5"
                      content={m.text}
                    />
                  )}
                  {!!m.attachments.length && (
                    <div className="group-attachments">
                      {m.attachments.map((a) => (
                        <a
                          className="group-attachment"
                          key={a.id}
                          href={`/api/v1/plugins/bots/http/attachment?id=${encodeURIComponent(a.id)}`}
                          download={a.name}
                        >
                          <Icon name="Paperclip" />
                          <span>{a.name}</span>
                          <span className="bot-help">
                            {a.sizeBytes < 1024
                              ? `${a.sizeBytes} B`
                              : `${Math.ceil(a.sizeBytes / 1024)} KB`}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                  {!!grouped.length && (
                    <div className="channel-reactions">
                      {grouped.map((emoji) => {
                        const people = reactions.filter(
                            (r) => r.messageId === m.id && r.emoji === emoji,
                          ),
                          mine = people.some((r) => r.actorId === "user");
                        return (
                          <button
                            key={emoji}
                            aria-label={`${emoji}: ${people.map((r) => r.actorName).join(", ")}`}
                            title={people.map((r) => r.actorName).join(", ")}
                            aria-pressed={mine}
                            onClick={() => void react(m, emoji)}
                          >
                            {emoji} <span>{people.length}</span>
                          </button>
                        );
                      })}
                      <ReactionPicker
                        label={`Add reaction to ${m.speaker}'s message`}
                        onReact={(emoji) => void react(m, emoji)}
                      />
                    </div>
                  )}
                  <div
                    className="bot-message-actions rounded-md border border-border bg-popover text-popover-foreground shadow-md"
                    aria-label={`Actions for ${m.speaker}'s message`}
                  >
                    <ReactionPicker onReact={(emoji) => void react(m, emoji)} />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Reply to ${m.speaker}`}
                      onClick={() => {
                        setReply(m);
                        if (bot)
                          setInsertion({
                            text: `@${bot.handle} `,
                            nonce: Date.now(),
                          });
                      }}
                    >
                      <Icon name="CornerDownRight" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Copy ${m.speaker}'s message`}
                      onClick={() => void copy(m)}
                    >
                      <Icon name={copied === m.id ? "Check" : "Copy"} />
                    </Button>
                    {job?.threadId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`View ${m.speaker}'s work`}
                        onClick={() => navigate.toThread(job.threadId!)}
                      >
                        <Icon name="ExternalLink" />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            </div>
          );
        })}
        {working.map((current) => {
          const b = bots.find((b) => b.id === current.botId);
          if (!b) return null;
          return (
            <div
              className="channel-agent-stub bot-room-message"
              key={current.id}
              role="status"
              aria-label={`${b.name} is ${current.cancellationPending ? "stopping" : "working"}`}
            >
              <span className="bot-message-avatar" aria-hidden>
                {b.avatar}
              </span>
              <div className="bot-message-body">
                <header>
                  <strong>{b.name}</strong>
                </header>
                <span
                  className="channel-thinking"
                  aria-label={
                    current.cancellationPending ? "Stopping" : "Working"
                  }
                >
                  <i />
                  <i />
                  <i />
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Stop ${b.name}'s response`}
                  disabled={!current}
                  onClick={() => {
                    if (current)
                      void rpc
                        .call("cancelJob", { id: current.id })
                        .catch((e) => setFailure(message(e)));
                  }}
                >
                  <Icon name="Square" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <GroupComposer
        key={id}
        autoFocus={!messages.length}
        roomId={id}
        roomName={room.name}
        paused={!!room.archived}
        bots={bots}
        memberIds={room.memberIds}
        onCreateBot={() => setCreateOpen(true)}
        reply={reply}
        onClearReply={() => setReply(null)}
        insertion={insertion}
        onInserted={() => setInsertion(null)}
        onSent={() => {
          atBottom.current = true;
          load();
        }}
      />
      <NewBot
        room={room}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(b) =>
          setInsertion({
            text: `@${b.handle} `,
            nonce: Date.now(),
            replaceMention: true,
          })
        }
      />
    </div>
  );
}
