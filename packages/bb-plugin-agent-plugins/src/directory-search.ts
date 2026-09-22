// MCP Directory Search — Ora, GitHub, HuggingFace
export interface McpDiscoveryEntry {
  name: string;
  description: string;
  type: string;
  source: string;
  url: string;
  tags?: string[];
  score?: number;
  configHint?: string;
  capabilities?: string[];
}

export interface SearchResult {
  results: McpDiscoveryEntry[];
  errors?: string[];
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function searchMcpDirectories(
  query: string,
  sources?: string[],
  pageSize?: number,
): Promise<SearchResult> {
  const errors: string[] = [];
  const results: McpDiscoveryEntry[] = [];
  const targetSources = sources ?? ["ora", "github", "huggingface"];
  const ps = pageSize ?? 10;

  const fetchJson = async (url: string, init?: RequestInit): Promise<unknown> => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), ...init });
    if (!res.ok) throw new Error("HTTP " + res.status + ": " + res.statusText);
    return res.json();
  };

  const ora = async () => {
    try {
      const body = JSON.stringify({
        query: { text: query, filter: { type: ["application/mcp-server-card+json"] } },
        pageSize: ps,
      });
      const raw = await fetchJson("https://directory.ora.ai/api/ard/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = raw as {
        results?: Array<{
          displayName?: string;
          description?: string;
          type?: string;
          url?: string;
          tags?: string[];
          score?: number;
          capabilities?: string[];
          oraScorecard?: { score?: number; grade?: string };
        }>;
      };
      if (!data.results) return;
      for (const r of data.results) {
        if (!r.displayName || !r.url) continue;
        results.push({
          name: r.displayName,
          description: r.description ?? "",
          type: r.type ?? "mcp-server",
          source: "ora",
          url: r.url,
          tags: (r.tags ?? []).filter(Boolean),
          score: r.oraScorecard?.score ?? r.score,
          configHint: r.type?.includes("mcp-server")
            ? JSON.stringify({ url: r.url })
            : undefined,
          capabilities: (r.capabilities ?? []).filter(Boolean),
        });
      }
    } catch (e) {
      errors.push("Ora: " + errorText(e));
    }
  };

  const github = async () => {
    try {
      const url = "https://api.github.com/search/repositories?q=" + encodeURIComponent(query + " topic:mcp") + "&per_page=" + ps + "&sort=stars";
      const raw = await fetchJson(url);
      const data = raw as {
        items?: Array<{
          full_name: string;
          description: string | null;
          html_url: string;
          topics?: string[];
          stargazers_count: number;
          language: string | null;
        }>;
      };
      if (!data.items) return;
      for (const r of data.items) {
        results.push({
          name: r.full_name,
          description: r.description ?? "",
          type: "mcp-repo",
          source: "github",
          url: r.html_url,
          tags: (r.topics ?? []).filter(Boolean).concat(r.language ? [r.language] : []),
          score: r.stargazers_count,
          configHint: r.html_url,
          capabilities: [],
        });
      }
    } catch (e) {
      errors.push("GitHub: " + errorText(e));
    }
  };

  const huggingface = async () => {
    try {
      const url = "https://huggingface.co/api/spaces?search=" + encodeURIComponent(query + " mcp") + "&limit=" + ps + "&sort=likes";
      const raw = await fetchJson(url);
      const data = raw as Array<{ id: string; likes: number; tags?: string[]; sdk: string; private: boolean }>;
      if (!Array.isArray(data)) return;
      for (const r of data) {
        if (r.private) continue;
        results.push({
          name: r.id,
          description: "HF Space (SDK: " + r.sdk + ") \u2014 " + r.likes + " likes",
          type: "mcp-space",
          source: "huggingface",
          url: "https://huggingface.co/spaces/" + r.id,
          tags: (r.tags ?? []).filter(Boolean),
          score: r.likes,
          configHint: r.sdk === "docker" ? "HF Space: " + r.id : undefined,
          capabilities: [],
        });
      }
    } catch (e) {
      errors.push("HuggingFace: " + errorText(e));
    }
  };

  const tasks: (() => Promise<void>)[] = [];
  if (targetSources.includes("ora")) tasks.push(ora);
  if (targetSources.includes("github")) tasks.push(github);
  if (targetSources.includes("huggingface")) tasks.push(huggingface);
  await Promise.all(tasks.map((t) => t().catch((e) => errors.push(errorText(e)))));
  return { results, errors };
}
