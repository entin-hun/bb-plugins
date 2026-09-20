import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useBbNavigate,
  experimental_Icon as Icon,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { Bot, Conversation, Job, Room, rpcContract } from "./contract";
import { Button } from "./components/ui/button";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "./components/ui/coarse-pointer-sizing";
import {
  BackButton,
  TabBar,
  ProfileForm,
  DocumentEditor,
  WorkList,
  ErrorMessage,
  message,
} from "./bot-ui";
import {
  ChannelsPage,
  ChannelsHeader,
  ChannelsSidebar,
  ChannelsNavigation,
  ChannelRedirect,
} from "./channels";
import { BotCollection } from "./bot-collection";
import "./styles.css";
const tabs = ["profile", "mission", "memory", "activity"] as const;
function BotDetail({ id, tab }: { id: string; tab: string }) {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [data, setData] = useState<{
      bot: Bot;
      conversations: Conversation[];
      jobs: Job[];
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false);
  const load = useCallback(() => {
    rpc.call("get", { id }).then(setData, (e) => setError(message(e)));
  }, [rpc, id]);
  useEffect(load, [load]);
  useRealtime("changed", load);
  const action = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setPending(false);
    }
  };
  if (!data)
    return (
      <div className="bot-page">
        <ErrorMessage error={error} />
        <p role="status">Loading bot…</p>
      </div>
    );
  const { bot, jobs } = data;
  return (
    <div className="bot-detail">
      <header className="bot-thread-bar">
        <BackButton />
        <span className="bot-inline-avatar" aria-hidden>
          {bot.avatar}
        </span>
        <h1>{bot.name}</h1>
        <TabBar
          items={tabs}
          selected={tab}
          label="Bot sections"
          onSelect={(t) =>
            navigate.toPluginPanel("bots", { subPath: `${id}/${t}` })
          }
        />
        <div className="bot-bar-actions">
          <span className="bot-status">
            {bot.paused ? "Mission paused" : bot.error ? "Needs attention" : ""}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
            aria-label={
              bot.paused ? "Resume mission work" : "Pause mission work"
            }
            disabled={pending}
            onClick={() =>
              action(() => rpc.call("pause", { id, paused: !bot.paused }))
            }
          >
            <Icon name={bot.paused ? "Play" : "Pause"} />
          </Button>
        </div>
      </header>
      {(error || bot.error) && (
        <div className="bot-error">
          <ErrorMessage error={error || bot.error} />
        </div>
      )}
      {
        <div className="bot-section">
          <div className="bot-config-content">
            {tab === "profile" && (
              <ProfileForm key={bot.id} bot={bot} onSaved={load} />
            )}
            {(tab === "mission" || tab === "memory") && (
              <DocumentEditor
                key={`${id}/${tab}`}
                bot={bot}
                file={tab === "mission" ? "MISSION.md" : "MEMORY.md"}
              />
            )}
            {tab === "activity" && (
              <>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Activity
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || bot.paused}
                    onClick={() => action(() => rpc.call("wake", { id }))}
                  >
                    Wake now
                  </Button>
                </div>
                <div className="bot-activity-panel">
                  <WorkList
                    jobs={jobs}
                    bots={[bot]}
                    onCancel={(jobId) =>
                      action(() => rpc.call("cancelJob", { id: jobId }))
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      }
    </div>
  );
}
function BotsPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>(),
    navigate = useBbNavigate();
  const [data, setData] = useState<{ bots: Bot[]; rooms: Room[] } | null>(null),
    [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc.call("list").then(
      (r) => {
        setData(r);
        setError(null);
      },
      (e) => setError(message(e)),
    );
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime("changed", load);
  const [id, section] = subPath.split("/");
  const bots = data?.bots ?? [];
  if (id === "new")
    return (
      <div className="bot-page bot-create-page">
        <div className="bot-config-content">
          <div className="mb-5 flex items-center gap-2">
            <BackButton />
            <h1>New bot</h1>
          </div>
          <ProfileForm
            onSaved={(b) =>
              navigate.toPluginPanel("bots", { subPath: `${b.id}/mission` })
            }
            onCancel={() => navigate.toPluginPanel("bots")}
          />
        </div>
      </div>
    );
  if (id === "new-group" || id === "group")
    return <ChannelRedirect subPath={id === "group" ? section : "new"} />;
  if (id)
    return (
      <div className="bot-route">
        <BotDetail
          key={id}
          id={id}
          tab={
            tabs.includes(section as (typeof tabs)[number])
              ? section
              : "profile"
          }
        />
      </div>
    );
  return <BotCollection bots={bots} loading={!data} error={error} />;
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "bots",
    title: "Bots",
    icon: "Bot",
    path: "bots",
    component: BotsPage,
  });
  app.slots.navPanel({
    id: "channels",
    title: "Channels",
    icon: "MessageSquare",
    path: "channels",
    component: ChannelsPage,
    headerContent: ChannelsHeader,
  });
  app.slots.experimental_threadList({
    id: "channels",
    title: "Channels and threads",
    component: ChannelsSidebar,
  });
  app.slots.experimental_sidebarNavigation({
    id: "channels",
    title: "Channels navigation",
    component: ChannelsNavigation,
  });
});
