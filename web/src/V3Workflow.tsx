import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { resetV3Connection, v3Api, v3Base } from "./v3Api.ts";
import { PIPELINE, type AttackReview, type AttackRun, type TrainingRun, type TrainingSource } from "./v3Types.ts";

const STEP_LABELS = { collect: "Verify training decisions", scale: "Multiply tasks, one factor at a time", export: "Export chat + robot datasets", hf_publish: "Publish optional Hugging Face copy", upload: "Upload dataset to Crusoe", job: "Create Lightning training job" };
const terminal = (s?: string) => ["succeeded", "failed", "cancelled"].includes(s ?? "");
const stepReason = (step: string, value?: string) => !value ? null : step === "hf_publish" && value.includes("not set") ? "Hugging Face publishing is not configured. The robot dataset is available to download." : step === "scale" && value.includes("is 0") ? "No new variants were requested." : ["upload","job"].includes(step) && value.includes("upload: false") ? "Export-only run. No provider job was requested." : value;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
function Counts({ values }: { values: [string, number | string][] }) { return <div className="v3-counts">{values.map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>; }
function Metric({ series }: { series: TrainingRun["provider"]["metrics"][number] }) {
  const data = series.data.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.value));
  if (!data.length) return null;
  const xs = data.map((p) => p.x), ys = data.map((p) => p.value), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const axis = minX > 1e11 ? `${new Date(minX).toISOString().slice(11,19)}–${new Date(maxX).toISOString().slice(11,19)} UTC` : `Provider steps ${minX}–${maxX}`;
  const label = series.metric_name === "ev_loss" ? "Training loss" : series.metric_name === "ev_train_loss" ? "Mean training loss" : series.metric_name;
  return <figure className="v3-metric"><figcaption title={series.metric_name}>{label}<strong>{data.at(-1)!.value.toPrecision(5)}</strong></figcaption><svg viewBox="0 0 400 100" role="img" aria-label={`${label}: ${data.length} actual provider measurements`}><polyline points={data.map((p) => `${10 + (p.x - minX) / (maxX - minX || 1) * 380},${90 - (p.value - minY) / (maxY - minY || 1) * 80}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />{data.length === 1 && <circle cx="10" cy="90" r="3" fill="currentColor" />}</svg><small>{axis} · range {minY.toPrecision(4)}–{maxY.toPrecision(4)}</small></figure>;
}

export default function V3Workflow({ kind, shiftId }: { kind: "adversary" | "post-training"; shiftId: string }) {
  const [ids, setIds] = useState<string[]>([]), [id, setId] = useState("");
  const [attack, setAttack] = useState<AttackRun | null>(null), [training, setTraining] = useState<TrainingRun | null>(null);
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(11), [attempts, setAttempts] = useState(4);
  const [sources, setSources] = useState<TrainingSource[]>([]), [source, setSource] = useState("");
  const [variants, setVariants] = useState(3), [upload, setUpload] = useState(false), [base, setBase] = useState("/api");
  const [reviewId, setReviewId] = useState(""), [review, setReview] = useState<AttackReview["review"]>(null);
  const alive = useRef(true), submitting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const connect = async () => {
    resetV3Connection();
    setLoading(true); setError(null);
    try {
      const [list, origin] = await Promise.all([v3Api<{ runs: (AttackRun | TrainingRun)[] }>(`/${kind}`), v3Base()]);
      if (!alive.current) return;
      if (!Array.isArray(list.runs)) throw new Error("The workflow service returned an invalid run list.");
      const available = list.runs.map((r) => "adversary_id" in r ? r.adversary_id : r.post_training_id);
      setIds(available); setBase(origin);
      const running = list.runs.find((r) => r.status === "running" || ("provider" in r && r.provider.job.id && !terminal(r.provider.job.status)));
      const runningId = running ? "adversary_id" in running ? running.adversary_id : running.post_training_id : null;
      setId(runningId ?? available[0] ?? "");
      if (kind === "post-training") {
        const data = await v3Api<{ sources: TrainingSource[] }>("/post-training/sources");
        if (alive.current) { setSources(data.sources); setSource(data.sources.find((s) => s.shift_id === shiftId)?.shift_id ?? data.sources.find((s) => s.shift_id && s.worker === "llm")?.shift_id ?? ""); }
      }
    } catch (e) { if (alive.current) setError(errorText(e)); }
    finally { if (alive.current) setLoading(false); }
  };
  useEffect(() => { void connect(); }, []);
  useEffect(() => {
    if (!id) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (kind === "adversary") { const run = await v3Api<AttackRun>(`/adversary/${id}`); if (active) setAttack(run); }
        else {
          let run = await v3Api<TrainingRun>(`/post-training/${id}`);
          if (!active) return;
          // This endpoint only looks up provider state. It never uploads or creates a job.
          if (run.provider.job.id && !terminal(run.provider.job.status) && (!run.provider.last_polled_at || Date.now() - Date.parse(run.provider.last_polled_at) > 10000)) run = await v3Api<TrainingRun>(`/post-training/${id}/refresh`, {});
          if (active) setTraining(run);
        }
        if (active) setError(null);
      } catch (e) { if (active) setError(errorText(e)); }
      finally { if (active) timer = setTimeout(poll, 3000); }
    };
    setAttack(null); setTraining(null); void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [kind, id]);
  useEffect(() => {
    if (!reviewId || !id) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const data = await v3Api<AttackReview>(`/adversary/${id}/reviews/${reviewId}`); if (active) setReview(data.review); } catch (e) { if (active) setError(errorText(e)); } finally { if (active) timer = setTimeout(poll, 3000); } };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [id, reviewId]);
  const start = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const run = kind === "adversary" ? await v3Api<AttackRun>("/adversary", { seed, attempts, brain: "live", worker: "llm", proposer: "llm", task: { type: "PICK", slot: "A-1-3-1" } }) : await v3Api<{ post_training_id: string }>("/post-training", { ...(source ? { shift_id: source } : {}), brain: "live", worker: "llm", upload, variants_per_task: variants, max_tasks: 1 });
      if (!alive.current) return;
      const next = "adversary_id" in run ? run.adversary_id : run.post_training_id;
      setIds((old) => [next, ...old.filter((v) => v !== next)]); setId(next);
    } catch (e) { if (alive.current) setError(`${errorText(e)} No automatic retry was sent. Refresh the run list before trying again if the outcome is uncertain.`); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  };
  const reviewFailure = async (sid: string) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true);
    try {
      const saved = await v3Api<AttackReview>(`/adversary/${id}/reviews/${sid}`);
      if (!saved.review) await v3Api(`/adversary/${id}/review`, { shift_id: sid });
      if (alive.current) { setReviewId(sid); setReview(saved.review); }
    }
    catch (e) { if (alive.current) setError(errorText(e)); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  };
  const activeRun = kind === "adversary" ? attack : training;
  const displayStatus = training?.provider.job.id ? training.provider.job.status ?? "submitted" : activeRun?.status;
  const lossMetrics = training?.provider.metrics.filter((s) => /loss/i.test(s.metric_name) && s.data.length) ?? [];
  const otherMetrics = training?.provider.metrics.filter((s) => !/loss/i.test(s.metric_name) && s.data.length) ?? [];
  return <div className="v3-workflow">
    <p>{kind === "adversary" ? "GLM selects bounded store disturbances; Lightning tests them and records the failures. The live brain is not changed." : "Verified training decisions become a larger dataset. Optionally upload it and create a Crusoe fine-tuning job. Held-out evaluations are excluded."}</p>
    {error && <div className="v3-error" role="alert">{error}<button onClick={() => { resetV3Connection(); void connect(); }}><RefreshCw size={13} /> Refresh connection</button></div>}
    {loading && <p className="v3-loading"><LoaderCircle size={17} className="spin" /> Loading saved status…</p>}
    {!!ids.length && <label className="v3-history">Saved or running workflow<select value={id} onChange={(e) => { setId(e.target.value); setReviewId(""); setReview(null); }}>{ids.map((value) => <option key={value}>{value}</option>)}</select></label>}
    <details className="v3-new-run" open={!ids.length && !loading}><summary>Run a new {kind === "adversary" ? "attack" : "data pipeline"}</summary>
      <div className="v3-form">{kind === "adversary" ? <><label>Training seed<input type="number" min="1" max="20" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label><label>Disturbances<select value={attempts} onChange={(e) => setAttempts(Number(e.target.value))}>{[1,2,3,4].map((n) => <option key={n}>{n}</option>)}</select></label><small>PICK A-1-3-1 · live brain · Lightning workers · training seeds only</small></> : <><label>Verified training source<select value={source} onChange={(e) => setSource(e.target.value)}><option value="">All eligible training recordings</option>{[...new Map(sources.filter((s) => s.shift_id).map((s) => [s.shift_id!,s])).values()].map((s) => <option key={s.shift_id} value={s.shift_id!}>{s.shift_id} · seed {s.seed} · v{s.brain_version}</option>)}</select></label><label>Variants per task<select value={variants} onChange={(e) => setVariants(Number(e.target.value))}>{[0,1,2,3].map((n) => <option key={n}>{n}</option>)}</select></label><label className="v3-checkbox"><input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} /> Upload and create a Crusoe training job</label><small>{upload ? "Creates one provider job after dataset verification." : "Data export only. No provider job will be created."} Variants use Lightning; zero variants replays saved training decisions without inference.</small></>}
      <button className="v3-primary" disabled={busy || loading || activeRun?.status === "running" || (kind === "adversary" && (!Number.isInteger(seed) || seed<1 || seed>20))} onClick={() => void start()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Play size={14} />}{kind === "adversary" ? "Start adversarial attack" : upload ? "Prepare data & create training job" : "Prepare training data"}</button></div>
    </details>
    {activeRun && <div className="v3-run-heading"><code>{id}</code><span className={`v3-state ${displayStatus}`}>{(activeRun.status === "running" || (training?.provider.job.id && !terminal(displayStatus))) && <LoaderCircle size={12} className="spin" />}{displayStatus}</span><small>Brain v{activeRun.brain_version} · updated {new Date(activeRun.updated_at).toLocaleTimeString()}</small></div>}
    {attack && <><Counts values={[["disturbances tested",attack.tried],["strict task failures",attack.broke],["model responses",attack.llm.calls],["local response replays",attack.llm.replayed ?? 0]]} /><p className="v3-note">{attack.model ?? "No model proposer recorded"} · {attack.worker === "llm" ? "Lightning workers" : "Compiled policy"} · seed {attack.seed}. Errors are separate from discovered task failures.</p>{attack.error && <p role="status" className="v3-error">{attack.error}</p>}<ol className="v3-attempts">{attack.attempts.map((a) => <li key={a.candidate}><header><strong>{a.disturbance.kind.replaceAll("_"," ")}</strong><span className="v3-state">{a.status === "done" ? a.broken ? "Task failed" : "Task succeeded" : a.status}</span></header><p>{a.rationale}</p><small>{a.successes ?? "—"}/{a.tasks ?? "—"} strict successes · {a.refusals ?? "—"} refusals{a.trial_id && ` · ${a.trial_id}`}</small>{a.error && <p className="v3-error">{a.error}</p>}{a.broken && a.shift_id && <button className="v3-secondary" disabled={busy} onClick={() => void reviewFailure(a.shift_id!)}>Review this training failure</button>}</li>)}</ol>{reviewId && <section className="v3-review"><h3>Supervisor & judge</h3><code>{reviewId}</code><p>{review?.status ?? "Reading failure…"}</p>{review?.judge && <p>{review.judge.kept.length} kept · {review.judge.dropped.length} dropped</p>}{review?.updates.map((u) => <p key={u.id}><strong>{u.id}</strong> {u.summary} · {u.judge_supported === false ? "Unsupported" : u.valid ? "Valid operations" : "Invalid operations"}</p>)}{review?.error && <p className="v3-error">{review.error}</p>}</section>}</>}
    {training && <><Counts values={[["verified tasks",training.collect?.tasks_accepted ?? "—"],["exported decisions",training.dataset?.examples ?? "—"],["episodes",training.dataset?.episodes ?? "—"],["model responses",training.llm.calls]]} /><ol className="v3-pipeline">{PIPELINE.map((step) => { const s=training.steps[step]; return <li key={step} className={s.status}><span className="v3-step-icon">{s.status === "completed" ? <Check size={15} /> : s.status === "started" ? <LoaderCircle size={15} className="spin" /> : PIPELINE.indexOf(step)+1}</span><div><strong>{STEP_LABELS[step]}</strong><span className="v3-state">{s.status}</span>{Object.keys(s.counts).length>0 && <small>{Object.entries(s.counts).map(([k,v]) => `${k.replaceAll("_"," ")}: ${v}`).join(" · ")}</small>}{(s.reason || s.error) && <p>{s.error ?? stepReason(step,s.reason)}</p>}</div></li>; })}</ol>
      {training.scale && <details><summary>Task variants and actual outcomes</summary><ul>{training.scale.variants.map((v) => <li key={v.variant_id}>{v.factor}: <strong>{v.status}</strong>{v.reason && ` · ${v.reason}`}</li>)}</ul></details>}
      {training.dataset && <section className="v3-exports"><h3>Download verified data</h3>{(["chat","robot","manifest"] as const).map((format) => <a key={format} href={`${base}/post-training/${id}/dataset?format=${format}`} target="_blank" rel="noreferrer">{format === "chat" ? "Crusoe chat JSONL" : format === "robot" ? "Robot named-action JSONL" : "Provenance manifest"}<ExternalLink size={12} /></a>)}<p className="v3-note">The robot export is LeRobot-style named-action data, with reconstructed observations. It contains no invented camera frames or joint commands.</p></section>}
      <section className="v3-provider"><h3>Crusoe training job</h3><p>{training.provider.job.id ? <><code>{training.provider.job.id}</code><span className="v3-state">{training.provider.job.status ?? training.provider.job.state}</span></> : training.provider.job.state === "unknown" ? "Submission outcome unknown. Refresh to look it up; it will not be submitted again." : "No provider job has been created."}</p>{training.provider.model && <p>{training.provider.model.model_name ?? training.provider.model.id}</p>}{training.provider.job.error && <p className="v3-error">{training.provider.job.error}</p>}{training.provider.job.provider?.error?.message && <p className="v3-error">{training.provider.job.provider.error.message}</p>}<a className="text-link" href={training.provider.console_url} target="_blank" rel="noreferrer">Open Crusoe fine-tuning dashboard <ExternalLink size={12} /></a>{training.provider.job.id && <button className="v3-secondary" disabled={busy} onClick={async () => { setBusy(true); try { const run=await v3Api<TrainingRun>(`/post-training/${id}/refresh`,{}); if(alive.current)setTraining(run); } catch(e){if(alive.current)setError(errorText(e));} finally {if(alive.current)setBusy(false);} }}><RefreshCw size={12} /> Refresh provider status</button>}
        {training.provider.poll_error && <p className="v3-error">{training.provider.poll_error}</p>}{lossMetrics.length ? lossMetrics.map((s) => <Metric key={s.metric_name} series={s} />) : <p className="v3-note">No training loss reported yet.</p>}
        {!!otherMetrics.length && <details><summary>Other provider metrics · {otherMetrics.length}</summary>{otherMetrics.map((s) => <Metric key={s.metric_name} series={s} />)}</details>}
        {!!training.provider.events.length && <details><summary>Provider events · {training.provider.events.length}</summary><ul>{training.provider.events.map((e,i) => <li key={e.id ?? i}>{e.message ?? e.level ?? "Provider event"}</li>)}</ul></details>}
        {training.provider.job.provider?.fine_tuned_model && <p>Output model <code>{training.provider.job.provider.fine_tuned_model}</code>. It has not been deployed or evaluated.</p>}
      </section>{training.error && <p className="v3-error">{training.error}</p>}</>}
    {!loading && !id && !error && <p className="v3-note">No saved workflows yet. Opening this dialog has made no model calls and started no job.</p>}
  </div>;
}
