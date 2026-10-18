import { Component, lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { Database, LoaderCircle, Swords, X } from "lucide-react";
import "./V3Dialogs.css";

const Workflow = lazy(() => import("./V3Workflow.tsx"));
class DialogBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">This workflow could not be displayed. Close and reopen this dialog to retry. Your dashboard is still available.</p> : this.props.children; }
}

/** Only these two existing placeholders change. Dialog code loads after an explicit click. */
export default function V3Actions({ shiftId }: { shiftId: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [kind, setKind] = useState<"adversary" | "post-training" | null>(null);
  const open = (next: "adversary" | "post-training") => { setKind(next); dialog.current?.showModal(); };
  return <>
    <div className="future-buttons">
      <button className="v3-data-button" onClick={() => open("post-training")}><Database size={13} /> Post-training Data<span>VERSION 3</span></button>
      <button className="v3-attack-button" onClick={() => open("adversary")}><Swords size={13} /> Adversarial Attack<span>VERSION 3</span></button>
    </div>
    <dialog ref={dialog} className={`v3-dialog ${kind === "adversary" ? "v3-attack" : "v3-data"}`} aria-labelledby={`v3-title-${shiftId}`} onClose={() => setKind(null)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.currentTarget.close(); } }}>
      <header><div><div className="eyebrow">VERSION 3 · ADDED AFTER SUBMISSION</div><h2 id={`v3-title-${shiftId}`}>{kind === "adversary" ? "Adversarial Attack" : "Post-training Data"}</h2></div><button className="v3-close" aria-label="Close workflow dialog" onClick={() => dialog.current?.close()}><X size={21} /></button></header>
      {kind && <DialogBoundary key={kind}><Suspense fallback={<p className="v3-loading"><LoaderCircle size={18} className="spin" /> Opening workflow…</p>}><Workflow kind={kind} shiftId={shiftId} /></Suspense></DialogBoundary>}
      <footer className="v3-dialog-footer">Closing this dialog leaves an explicitly started job running. Reopen it to see the latest saved status.</footer>
    </dialog>
  </>;
}
