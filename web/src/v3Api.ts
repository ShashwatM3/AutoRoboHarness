/** An optional separate workflow service keeps the running V2 demo API untouched. */
let base: Promise<string> | null = null;
export function v3Base(): Promise<string> {
  return base ??= fetch("/v3-runtime.json", { cache: "no-store", signal: AbortSignal.timeout(5000) }).then(async (r) => {
    if (!r.ok || !r.headers.get("content-type")?.includes("json")) return "/api";
    const config = await r.json();
    if (typeof config.api_base !== "string") return "/api";
    const url = new URL(config.api_base, location.origin);
    if (url.protocol !== "https:" && url.origin !== location.origin && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Invalid workflow service address");
    return url.href.replace(/\/$/, "");
  }).catch(() => "/api");
}
export function resetV3Connection() { base = null; }
export async function v3Api<T>(path: string, body?: unknown): Promise<T> {
  const root = await v3Base();
  let r: Response;
  try { r = await fetch(root + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) }); }
  catch { throw new Error("The workflow service is temporarily unavailable. Your dashboard is unaffected. Retry the connection to load its latest status."); }
  let data;
  try { data = await r.json(); } catch { throw new Error("The V3 workflow service is unavailable. Your demo is unaffected; retry when the service is ready."); }
  if (!r.ok) throw new Error(data.error ?? `Workflow request returned ${r.status}`);
  return data as T;
}
