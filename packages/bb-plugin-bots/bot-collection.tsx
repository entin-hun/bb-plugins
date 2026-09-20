import { useState } from "react";
import {
  useBbNavigate,
  experimental_Icon as Icon,
} from "@get-bb/plugin-sdk/app";
import type { Bot } from "./contract";
import { Button } from "./components/ui/button";
import {
  ResourceListPanel,
  ResourceRow,
  ResourceToolbar,
} from "./components/ui/resource-list";
import { Menu } from "./channel-controls";
import { ErrorMessage } from "./bot-ui";

export function BotCollection({
  bots,
  loading,
  error,
}: {
  bots: Bot[];
  loading: boolean;
  error: string | null;
}) {
  const navigate = useBbNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const search = query.trim().toLowerCase();
  const visible = bots
    .filter(
      (b) =>
        `${b.name} @${b.handle} ${b.description}`
          .toLowerCase()
          .includes(search) &&
        (status === "all" || (status === "attention" ? !!b.error : !b.error)),
    )
    .sort((a, b) =>
      sort === "recent"
        ? b.createdAt - a.createdAt
        : a.name.localeCompare(b.name),
    );
  return (
    <div className="h-full overflow-y-auto" data-bots-collection>
      <div className="mx-auto box-border flex w-full max-w-5xl flex-col gap-5 px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <p className="text-sm leading-5 text-muted-foreground">
          Create and manage bots with their own workspace, mission, and memory.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-sm font-medium">
            All bots{" "}
            <span className="text-2xs text-subtle-foreground">
              {bots.length}
            </span>
          </span>
          <Button
            size="sm"
            onClick={() => navigate.toPluginPanel("bots", { subPath: "new" })}
          >
            <Icon name="Plus" /> New bot
          </Button>
        </div>
        <ResourceToolbar
          value={query}
          onChange={setQuery}
          controls={
            <>
              <Menu
                label="Filter bots"
                open={filterOpen}
                onOpenChange={setFilterOpen}
                trigger={
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 p-0 text-muted-foreground"
                    aria-label="Filter bots"
                    aria-pressed={status !== "all"}
                  >
                    <Icon name="SlidersHorizontal" />
                  </Button>
                }
              >
                <p className="channel-menu-label">Status</p>
                {[
                  ["all", "All bots"],
                  ["ready", "Ready"],
                  ["attention", "Needs attention"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className="channel-menu-row"
                    aria-pressed={status === value}
                    onClick={() => {
                      setStatus(value!);
                      setFilterOpen(false);
                    }}
                  >
                    <span className="flex-1">{label}</span>
                    {status === value && <Icon name="Check" />}
                  </button>
                ))}
              </Menu>
              <Menu
                label="Sort bots"
                open={sortOpen}
                onOpenChange={setSortOpen}
                trigger={
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 p-0 text-muted-foreground"
                    aria-label="Sort bots"
                  >
                    <Icon name="ArrowUpDown" />
                  </Button>
                }
              >
                {[
                  ["name", "Name"],
                  ["recent", "Newest first"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className="channel-menu-row"
                    aria-pressed={sort === value}
                    onClick={() => {
                      setSort(value!);
                      setSortOpen(false);
                    }}
                  >
                    <span className="flex-1">{label}</span>
                    {sort === value && <Icon name="Check" />}
                  </button>
                ))}
              </Menu>
            </>
          }
        />
        <ErrorMessage error={error} />
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading bots…
          </p>
        ) : !bots.length ? (
          <div className="rounded-lg border border-border p-6 text-center">
            <p className="text-sm font-medium">Create your first bot</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Give it a mission, choose its model, and bring it into a channel.
            </p>
          </div>
        ) : !visible.length ? (
          <div
            className="rounded-lg border border-border p-6 text-center"
            role="status"
          >
            <p className="text-sm text-muted-foreground">
              No bots match your search or filters.
            </p>
            <Button
              variant="link"
              size="sm"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <ResourceListPanel>
            {visible.map((bot) => (
              <ResourceRow
                key={bot.id}
                leading={bot.avatar}
                title={bot.name}
                titleMeta={`@${bot.handle}`}
                description={bot.description}
                state={
                  <span
                    className={`text-xs ${bot.error ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {bot.error ? "Needs attention" : "Ready"}
                  </span>
                }
                onOpen={() =>
                  navigate.toPluginPanel("bots", {
                    subPath: `${bot.id}/profile`,
                  })
                }
              />
            ))}
          </ResourceListPanel>
        )}
      </div>
    </div>
  );
}
