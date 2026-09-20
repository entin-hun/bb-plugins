import type { Job } from "./contract";
export const isActiveJob = (job: Job) =>
  !!job.cancellationPending ||
  ["queued", "dispatching", "running"].includes(job.status);
// A bot runs serially. Its visible stop control must target the current response,
// even when newer requests have queued behind it.
export function channelWork(jobs: Job[]): Job[] {
  const priority = (job: Job) =>
    job.status === "running" ? 0 : job.status === "dispatching" ? 1 : 2;
  const sorted = jobs
    .filter(isActiveJob)
    .sort((a, b) => priority(a) - priority(b) || a.createdAt - b.createdAt);
  const seen = new Set<string>();
  return sorted.filter((job) => {
    if (seen.has(job.botId)) return false;
    seen.add(job.botId);
    return true;
  });
}
