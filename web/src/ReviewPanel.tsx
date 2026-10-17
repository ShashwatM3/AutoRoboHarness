import { useEffect, useState } from 'react';
import { ArrowRight, Check, ChevronRight, Code2, FileSearch, GitBranch, LoaderCircle, Play, ShieldCheck, Sparkles } from 'lucide-react';
import type { TrajectoryStep } from '../../engine/store.ts';
import { api, type Grounding, type ReviewInfo } from './api.ts';

function assetURL(path: string): string {
  const clean = path.replace(/^\//, '');
  return clean.startsWith('ground_truth/') && !clean.includes('..') ? `/${clean}` : '';
}

function RunSteps({ id, label }: { id: string; label: string }) {
  const [steps, setSteps] = useState<TrajectoryStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const [shift, robot] = id.split('/');
    if (!shift || !robot) { setError('The reference is missing a shift or robot ID.'); return; }
    api<TrajectoryStep[]>(`/shift/${encodeURIComponent(shift)}/trajectory?robot=${encodeURIComponent(robot)}`).then(data => { if (active) setSteps(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id]);
  return <div className="contrast-run"><strong>{label}</strong><span>{id}</span>{error ? <p>{error}</p> : !steps ? <p>Loading trajectory…</p> : <ol>{steps.map(step => <li key={step.step} className={step.ok ? '' : 'contrast-refused'}><span>{step.step}</span><div>{step.action}<small>{step.reason}</small></div></li>)}</ol>}</div>;
}

function Evidence({ grounding }: { grounding: Grounding }) {
  if (grounding.kind === 'clip') {
    const frames = grounding.frames?.map(assetURL).filter(Boolean) ?? [];
    return <div className="clip-evidence"><div className="evidence-caption"><span>RETAILACTION / {grounding.clip_id}</span><span>{grounding.verified ? 'REFERENCE FOUND' : 'UNVERIFIED REFERENCE'}</span></div>{frames.length ? <div className="evidence-frames">{frames.map((path, i) => <a key={path} href={path} target="_blank" rel="noreferrer" aria-label={`Open evidence frame ${i + 1}`}><img src={path} alt={`RetailAction ${grounding.clip_id}, action frame ${i + 1}`} loading="lazy" /><span>0{i + 1}</span></a>)}</div> : grounding.sheet && assetURL(grounding.sheet) ? <img className="evidence-sheet" src={assetURL(grounding.sheet)} alt={`Contact sheet for ${grounding.clip_id}`} /> : <p>The reference has no available frames.</p>}<p>{grounding.note ?? grounding.description}</p></div>;
  }
  return <div className="contrast-evidence"><div className="evidence-caption"><span>RUN CONTRAST</span><span>{grounding.verified ? 'REFERENCES FOUND' : 'UNVERIFIED REFERENCE'}</span></div><div className="contrast-grid"><RunSteps id={grounding.failed_run} label="Failed run" /><RunSteps id={grounding.ok_run} label="Successful sibling" /></div>{grounding.note && <p>{grounding.note}</p>}</div>;
}

export default function ReviewPanel({ shiftId, onReplay, onClose }: { shiftId: string; onReplay: (robot: string, step: number) => void; onClose: () => void }) {
  const [review, setReview] = useState<ReviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('The supervisor is reading the shift.');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true, timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<ReviewInfo>(`/review/${encodeURIComponent(shiftId)}`);
        if (!active) return;
        setReview(result); setError(result.status === 'error' ? result.error ?? 'The supervisor could not finish.' : null);
        if (result.status === 'running') timeout = setTimeout(poll, 3000);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'The review could not be loaded.'); }
    };
    void poll();
    const source = new EventSource('/api/events');
    source.addEventListener('review_progress', event => {
      try { const update = JSON.parse((event as MessageEvent).data); if (active && update.shift_id === shiftId) setProgress(update.msg); } catch { /* Polling retains the authoritative status. */ }
    });
    source.addEventListener('review_done', () => { if (active) { clearTimeout(timeout); void poll(); } });
    return () => { active = false; clearTimeout(timeout); source.close(); };
  }, [shiftId, retry]);

  const redo = async () => {
    setError(null);
    try { await api(`/review/${encodeURIComponent(shiftId)}?refresh=1`, { method: 'POST' }); setRetry(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'The review could not restart.'); }
  };

  return <section className="review-panel" aria-label="Shift review">
    <div className="review-heading"><div><div className="eyebrow">AFTER THE SHIFT / HARNESS REVIEW</div><h2>Every mistake has a lesson<span>.</span></h2><p>The supervisor connects the facts to evidence, then proposes what the shared brain should learn.</p></div><button className="back-to-store" onClick={onClose}>Back to live view<ArrowRight size={13} /></button></div>
    {error && <div className="inline-error" role="alert">{error}<button onClick={() => void redo()}>Retry review</button></div>}
    {(!review || review.status === 'running') && !error && <div className="review-working"><LoaderCircle className="spin" size={18} /><div><strong>The supervisor is working.</strong><p>{progress}</p></div>{review && <span>{review.tool_calls.length} evidence tool calls</span>}</div>}
    {review && <>
      <div className="review-facts"><span><FileSearch size={15} />{review.detected.refused_steps.length} refused actions in the engine log</span><span><ShieldCheck size={15} />{review.detected.incomplete_tasks.length} tasks need review</span><span><GitBranch size={15} />Brain v{review.brain_version}</span></div>
      <div className="review-columns">
        <section className="review-section failures-section"><div className="review-section-title"><span>01</span><h3>Failures</h3><small>{review.failures.length.toString().padStart(2, '0')}</small></div><p className="section-intro">The moment it went wrong. Each failure opens its recorded action in the store.</p>
          {review.failures.map(failure => <button key={failure.id} className="failure-card" onClick={() => onReplay(failure.robot, failure.step)}><div><span>{failure.id} / {failure.robot.toUpperCase()}</span><span><Play size={9} fill="currentColor" />STEP {failure.step}</span></div><h4>{failure.check.replaceAll('_', ' ')}</h4><p>{failure.cause}</p><span className="reference-state">{failure.verified ? <Check size={10} /> : '!'}{failure.verified ? 'Step exists in trajectory' : 'Step reference is unverified'}<ChevronRight size={12} /></span></button>)}
          {review.status === 'done' && !review.failures.length && <p className="empty-review">The supervisor reported no failures.</p>}
          {review.status === 'running' && review.detected.refused_steps.map((step, i) => <button className="failure-card engine-fact" key={`${step.robot}-${step.step}-${i}`} onClick={() => onReplay(step.robot, step.step)}><div><span>ENGINE FACT / {step.robot}</span><span>STEP {step.step}</span></div><h4>{step.action}</h4><p>{step.reason}</p></button>)}
        </section>
        <section className="review-section insights-section"><div className="review-section-title"><span>02</span><h3>Insights</h3><small>{review.insights.length.toString().padStart(2, '0')}</small></div><p className="section-intro">What better behavior looks like, with the footage or runs behind each claim.</p>{review.insights.map(insight => <article className="insight-card" key={insight.id}><div className="insight-label"><Sparkles size={12} /><span>{insight.id} / {insight.addresses.join(', ')}</span></div><h4>{insight.claim}</h4>{!insight.verified && <p className="unverified-note">The evidence references could not be confirmed.</p>}{insight.grounding.map((grounding, i) => <Evidence key={i} grounding={grounding} />)}</article>)}{review.status === 'done' && !review.insights.length && <p className="empty-review">The supervisor reported no insights.</p>}</section>
        <section className="review-section updates-section"><div className="review-section-title"><span>03</span><h3>Brain updates</h3><small>{review.updates.length.toString().padStart(2, '0')}</small></div><p className="section-intro">The proposed lesson in plain words, with its exact graph operations underneath.</p>{review.updates.map(update => <article key={update.id} className="update-card"><div className="update-label"><GitBranch size={12} /><span>{update.id} / {update.valid ? 'VALID OPERATIONS' : 'NEEDS REPAIR'}</span></div><h4>{update.summary}</h4>{update.touches_guardrail && <p className="unverified-note">This update changes a guardrail and needs approval.</p>}{update.errors.length > 0 && <p className="unverified-note">{update.errors.join(' · ')}</p>}<details><summary><Code2 size={12} />Graph operations<ChevronRight size={12} /></summary><pre>{JSON.stringify(update.compiled, null, 2)}</pre></details><details><summary>Supervisor edits<ChevronRight size={12} /></summary><pre>{JSON.stringify(update.ops, null, 2)}</pre></details></article>)}{review.status === 'done' && !review.updates.length && <p className="empty-review">The supervisor proposed no updates.</p>}
          <div className="review-next"><button disabled title="Waiting for Person B's held-out gate">Update Brain · Gate pending<ArrowRight size={13} /></button><p>The candidate must score higher on held-out seeds before it becomes the live brain.</p></div><div className="future-buttons"><button disabled>Run post-training<span>VERSION 3</span></button><button disabled>Adversarial attack<span>VERSION 3</span></button></div>
        </section>
      </div>
    </>}
  </section>;
}
