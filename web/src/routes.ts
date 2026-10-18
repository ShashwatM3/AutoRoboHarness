/** Hash routes for the three primary tabs. Older links (#shift, #trials, #brains) keep working. */
export type PrimaryTab = "live" | "results" | "development";
export type Stage = "launch" | "work" | "review";
export const STAGE_ORDER: Stage[] = ["launch", "work", "review"];

export interface Route {
  tab: PrimaryTab;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [rawPage, query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  const page = rawPage.toLowerCase();
  if (page === "results" || page === "trials") return { tab: "results", params };
  if (page === "brains") {
    // The brain explorer is now a drilldown inside Previous results.
    if (!params.has("view")) params.set("view", "brains");
    return { tab: "results", params };
  }
  if (page === "development") return { tab: "development", params };
  return { tab: "live", params };
}

export function buildHash(
  tab: PrimaryTab,
  params: Record<string, string | number | null | undefined> = {},
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== null && value !== undefined && value !== "")
      query.set(key, String(value));
  const text = query.toString();
  return `#${tab}${text ? `?${text}` : ""}`;
}

export function parseStage(value: string | null): Stage | null {
  return value === "launch" || value === "work" || value === "review"
    ? value
    : null;
}

/** Live work is reachable once a run exists; review once it has finished and the view has caught up. */
export function liveStages(state: {
  hasRun: boolean;
  finished: boolean;
  animating: boolean;
}): Record<Stage, boolean> {
  return {
    launch: true,
    work: state.hasRun,
    review: state.hasRun && state.finished && !state.animating,
  };
}
