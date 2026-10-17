import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  CircleDot,
  Compass,
  Cuboid,
  Focus,
  Grip,
  Layers3,
  LoaderCircle,
  Maximize2,
  Navigation,
  Play,
  Radio,
  RotateCcw,
  ScanLine,
  Settings2,
  Square,
  Store,
  Terminal,
  WandSparkles,
} from "lucide-react";
import {
  ACTIONS,
  createEngine,
  type Action,
  type Scenario,
  type TrajectoryStep,
} from "../../engine/store.ts";
import { StoreScene } from "./scene/StoreScene.ts";
import ShiftLab from "./ShiftLab.tsx";

type Preview = { initial: Scenario; steps: TrajectoryStep[] };
const ACTION_LABELS: Record<Action, string> = {
  navigate_to: "Drive",
  set_torso: "Lift torso",
  scan_slot: "Scan slot",
  reach: "Reach",
  grasp: "Grasp",
  retract: "Retract",
  place: "Place",
  report_issue: "Report",
};
const ACTION_ICONS = {
  navigate_to: Navigation,
  set_torso: ArrowUpRight,
  scan_slot: ScanLine,
  reach: ArrowUpRight,
  grasp: Grip,
  retract: ArrowDownToLine,
  place: Box,
  report_issue: Radio,
};

function buildPreview(seed: number): Preview {
  const engine = createEngine(seed);
  const target = Object.values(engine.scenario.items).find(
    (item) =>
      item.id.startsWith("item:") &&
      item.slot === item.home_slot &&
      engine.scenario.layout.slots[item.slot].level === 4,
  )!;
  const restockSlot = Object.values(engine.scenario.layout.slots).find(
    (slot) =>
      slot.aisle === "B" &&
      !Object.values(engine.scenario.items).some(
        (item) => item.slot === slot.id,
      ),
  )!;
  engine.createTask("robot-1", "PICK", target.home_slot);
  if (restockSlot) engine.createTask("robot-2", "RESTOCK", restockSlot.id);
  const initial = engine.snapshot();
  const slot = engine.scenario.layout.slots[target.slot];
  engine.navigate_to("robot-1", slot.waypoint);
  engine.set_torso("robot-1", slot.level);
  engine.scan_slot("robot-1", slot.id);
  engine.reach("robot-1", slot.id);
  engine.grasp("robot-1", "two_hand");
  engine.retract("robot-1");
  engine.navigate_to("robot-1", "tote");
  engine.place("robot-1", "tote");
  if (restockSlot) {
    engine.reach("robot-2", `backroom:${restockSlot.id}`);
    engine.grasp("robot-2", "two_hand");
    engine.retract("robot-2");
    engine.navigate_to("robot-2", restockSlot.waypoint);
    engine.set_torso("robot-2", restockSlot.level);
    engine.reach("robot-2", restockSlot.id);
    engine.place("robot-2", restockSlot.id);
    engine.retract("robot-2");
  }
  return { initial, steps: engine.snapshot().trajectory };
}

declare global {
  interface Window {
    __AUTO_ROBO_PREVIEW__?: {
      scene: StoreScene;
      preview: Preview;
      cursor: number;
      run: () => Promise<void>;
    };
  }
}

export default function App() {
  const [previewMode, setPreviewMode] = useState(false);
  return previewMode ? (
    <PreviewLab onLaunch={() => setPreviewMode(false)} />
  ) : (
    <ShiftLab onPreview={() => setPreviewMode(true)} />
  );
}

function PreviewLab({ onLaunch }: { onLaunch: () => void }) {
  const [seed, setSeed] = useState(1);
  const [preview, setPreview] = useState<Preview>(() => buildPreview(1));
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedRobot, setSelectedRobot] = useState("robot-1");
  const [view, setView] = useState<"perspective" | "overhead">("perspective");
  const [grid, setGrid] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<StoreScene | null>(null);
  const playToken = useRef(0);
  const cursorRef = useRef(0);
  const runningRef = useRef(false);
  const stopRequested = useRef(false);
  const runRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!host.current) return;
    setReady(false);
    setError(null);
    let instance: StoreScene;
    try {
      instance = new StoreScene(host.current, preview.initial);
      scene.current = instance;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The 3D view could not start.");
      return;
    }
    let active = true;
    instance.ready
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Store assets could not load.",
          );
      });
    if (import.meta.env.DEV)
      window.__AUTO_ROBO_PREVIEW__ = {
        scene: instance,
        preview,
        cursor: 0,
        run: () => runRef.current(),
      };
    return () => {
      active = false;
      playToken.current++;
      instance.dispose();
      scene.current = null;
      delete window.__AUTO_ROBO_PREVIEW__;
    };
  }, [preview, generation]);

  const reset = useCallback(
    (newSeed = seed) => {
      playToken.current++;
      runningRef.current = false;
      setPlaying(false);
      cursorRef.current = 0;
      setCursor(0);
      setSelectedAction(null);
      setPreview(buildPreview(newSeed));
      setGeneration((n) => n + 1);
      setView("perspective");
    },
    [seed],
  );

  const run = async (oneStep = false) => {
    if (
      !ready ||
      !scene.current ||
      runningRef.current ||
      cursorRef.current >= preview.steps.length
    )
      return;
    const token = ++playToken.current;
    stopRequested.current = false;
    runningRef.current = true;
    setPlaying(true);
    try {
      do {
        const step = preview.steps[cursorRef.current];
        setSelectedRobot(step.robot);
        setSelectedAction(step.action);
        await scene.current.playStep(step, speed);
        if (token !== playToken.current) return;
        cursorRef.current++;
        setCursor(cursorRef.current);
        if (window.__AUTO_ROBO_PREVIEW__)
          window.__AUTO_ROBO_PREVIEW__.cursor = cursorRef.current;
      } while (
        !oneStep &&
        !stopRequested.current &&
        cursorRef.current < preview.steps.length &&
        token === playToken.current
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Animation could not play.");
    } finally {
      if (token === playToken.current) {
        setPlaying(false);
        runningRef.current = false;
      }
    }
  };
  runRef.current = () => run();
  const stop = () => {
    stopRequested.current = true;
  };
  const last = preview.steps
    .slice(0, cursor)
    .filter((s) => s.robot === selectedRobot)
    .at(-1);
  const robot = last?.robot_state ?? preview.initial.robots[selectedRobot];
  const task = Object.values(preview.initial.tasks).find(
    (t) => t.robot === selectedRobot,
  );
  const selectedItem = task ? preview.initial.items[task.item_id] : null;
  const finished = cursor === preview.steps.length;
  const changeView = (next: "perspective" | "overhead") => {
    setView(next);
    scene.current?.setView(next);
  };

  return (
    <div className="app-shell">
      <aside className="rail">
        <a className="brand-mark" href="/" aria-label="AutoRoboHarness home">
          <Cuboid size={25} strokeWidth={1.6} />
        </a>
        <span className="rail-divider" />
        <button
          className="rail-icon active"
          aria-label="Store lab"
          title="Store lab"
        >
          <Store size={21} />
        </button>
        <span className="rail-spacer" />
        <div className="version-badge">V1</div>
        <span className="avatar">SM</span>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="wordmark">
            auto<span>robo</span>
            <span className="wordmark-divider">/</span>
            <small>HARNESS</small>
          </div>
          <div className="topbar-middle">
            <span className="status-dot" /> STORE LAB{" "}
            <span className="slash">/</span> CONVENIENCE STORE
          </div>
          <div className="topbar-right">
            <button className="outline-tag" onClick={onLaunch}>
              LIVE SHIFTS ↗
            </button>
            <span className="outline-tag">ENGINE PREVIEW</span>
            <span className="tiny-dot" /> LOCAL
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">WORKSPACE / SIMULATION</div>
              <h1>
                A little store.
                <br className="mobile-break" /> A lot to learn<span>.</span>
              </h1>
              <p>A shared world for robots that get better with every shift.</p>
            </div>
            <div className="seed-control">
              <span>SCENARIO</span>
              <label htmlFor="seed">
                Seed{" "}
                <select
                  id="seed"
                  value={seed}
                  disabled={playing}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setSeed(n);
                    reset(n);
                  }}
                >
                  {Array.from({ length: 20 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {String(i + 1).padStart(2, "0")}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
          </section>
          <section className="lab-layout">
            <div className="store-card">
              <div className="card-toolbar">
                <div>
                  <span className="live-dot" />
                  <strong>Store environment</strong>
                  <span className="subtle-tag">01</span>
                </div>
                <div className="view-switch">
                  <button
                    className={view === "perspective" ? "selected" : ""}
                    onClick={() => changeView("perspective")}
                  >
                    <Cuboid size={14} /> 3D view
                  </button>
                  <button
                    className={view === "overhead" ? "selected" : ""}
                    onClick={() => changeView("overhead")}
                  >
                    <Layers3 size={14} /> Top view
                  </button>
                </div>
              </div>
              <div className="viewport-wrap">
                <div className="scene-host" ref={host} />
                <div className="viewport-top">
                  <span className="map-label">
                    <span className="status-dot" /> STORE WING A
                  </span>
                  <span className="map-label secondary">
                    2 AISLES <span>·</span> 4 LEVELS
                  </span>
                </div>
                {!ready && !error && (
                  <div className="loading">
                    <LoaderCircle className="spin" size={20} />
                    <span>Preparing the store…</span>
                  </div>
                )}
                {error && (
                  <div className="scene-error" role="alert">
                    {error}
                    <button onClick={() => reset()}>Try again</button>
                  </div>
                )}
                <div className="viewport-controls">
                  <button
                    aria-label="Reset camera"
                    title="Reset camera"
                    onClick={() => changeView("perspective")}
                  >
                    <Compass size={17} />
                  </button>
                  <button
                    aria-label="Focus selected robot"
                    title="Focus selected robot"
                    onClick={() => scene.current?.focusRobot(selectedRobot)}
                  >
                    <Focus size={17} />
                  </button>
                  <button
                    aria-label="Toggle floor grid"
                    aria-pressed={grid}
                    title="Toggle floor grid"
                    onClick={() => {
                      setGrid(!grid);
                      scene.current?.setGrid(!grid);
                    }}
                  >
                    <Maximize2 size={17} />
                  </button>
                </div>
                <div className="viewport-bottom">
                  <span>
                    <span className="legend-square orange" /> R01{" "}
                    <span className="legend-square blue" /> R02
                  </span>
                  <span>
                    Drag to orbit <span>·</span> Scroll to zoom
                  </span>
                </div>
              </div>
              <div className="store-caption">
                <div>
                  <CircleDot size={15} />
                  <span>One world. Every action recorded.</span>
                </div>
                <span>
                  KENNEY ASSETS <span>↗</span>
                </span>
              </div>
            </div>
            <aside className="inspector">
              <div className="inspector-heading">
                <div className="eyebrow">ROBOT BENCH</div>
                <Settings2 size={15} />
              </div>
              <div className="robot-tabs">
                {["robot-1", "robot-2"].map((id, i) => (
                  <button
                    key={id}
                    className={selectedRobot === id ? "chosen" : ""}
                    onClick={() => setSelectedRobot(id)}
                  >
                    <span
                      className={`robot-tab-dot ${i ? "blue" : "orange"}`}
                    />{" "}
                    R0{i + 1}
                    <span className="robot-tab-state">
                      {playing && selectedRobot === id ? "MOVING" : "READY"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="robot-identity">
                <div
                  className={`robot-glyph ${selectedRobot === "robot-2" ? "blue-robot" : ""}`}
                >
                  <div className="glyph-head">
                    <i />
                    <i />
                  </div>
                  <div className="glyph-neck" />
                  <div className="glyph-body" />
                  <div className="glyph-base" />
                  <span />
                </div>
                <div>
                  <span className="eyebrow">MOBILE MANIPULATOR</span>
                  <h2>
                    {selectedRobot === "robot-1" ? "Scout" : "Atlas"}{" "}
                    <span>0{selectedRobot === "robot-1" ? "1" : "2"}</span>
                  </h2>
                  <span className="ready-label">
                    <span className="status-dot" />
                    {playing
                      ? "Action in progress"
                      : finished
                        ? "Preview complete"
                        : "Ready to move"}
                  </span>
                </div>
              </div>
              <div className="task-card">
                <span className="eyebrow">PREVIEW TASK</span>
                <div>
                  <span className="task-type">{task?.type ?? "IDLE"}</span>
                  <strong>{selectedItem?.name ?? "No item"}</strong>
                  <Box size={17} />
                </div>
                <p>
                  {task?.type === "PICK"
                    ? `${task.source} → Order tote`
                    : `Backroom → ${task?.target}`}
                </p>
              </div>
              <div className="physical-stats">
                <div>
                  <span>Torso level</span>
                  <strong>
                    {robot.torso_level}
                    <small> / 4</small>
                  </strong>
                </div>
                <div>
                  <span>Payload</span>
                  <strong>
                    {selectedItem?.weight_kg.toFixed(1) ?? "0.0"}
                    <small> kg</small>
                  </strong>
                </div>
                <div>
                  <span>Arm</span>
                  <strong>{robot.arm_out ? "Extended" : "Retracted"}</strong>
                </div>
                <div>
                  <span>Gripper</span>
                  <strong>{robot.holding ? "Holding" : "Empty"}</strong>
                </div>
              </div>
              <div className="action-section">
                <div className="section-title">
                  ACTION SET<span>08</span>
                </div>
                <div className="action-grid">
                  {ACTIONS.map((action) => {
                    const Icon = ACTION_ICONS[action];
                    return (
                      <div
                        key={action}
                        className={
                          selectedAction === action &&
                          last?.robot === selectedRobot
                            ? "action active-action"
                            : "action"
                        }
                      >
                        <Icon size={14} />
                        <span>{ACTION_LABELS[action]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="bench-note">
                <WandSparkles size={17} />
                <p>
                  This preview checks robot motion.
                  <br />
                  Agent-driven shifts are the next step.
                </p>
              </div>
            </aside>
          </section>
          <section className="playback-card">
            <div className="playback-heading">
              <div className="playback-icon">
                <Terminal size={18} />
              </div>
              <div>
                <h3>Action preview</h3>
                <p>
                  {finished
                    ? "Both robot tasks completed in the local engine."
                    : "A real engine trajectory, played one action at a time."}
                </p>
              </div>
              <span className="preview-tag">LOCAL · NO MODEL CALLS</span>
            </div>
            <div className="playback-controls">
              <button
                className="reset-button"
                aria-label="Reset preview"
                title="Reset preview"
                onClick={() => reset()}
              >
                <RotateCcw size={17} />
              </button>
              <button
                className="step-button"
                disabled={!ready || playing || finished}
                onClick={() => void run(true)}
              >
                Step
              </button>
              <button
                className="play-button"
                disabled={!ready || finished}
                onClick={() => (playing ? stop() : void run())}
              >
                {playing ? (
                  <Square size={14} fill="currentColor" />
                ) : finished ? (
                  <Check size={17} />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                {playing
                  ? "Stop preview"
                  : finished
                    ? "Complete"
                    : "Play preview"}
              </button>
            </div>
            <div className="timeline">
              <div className="timeline-track">
                <span
                  style={{ width: `${(cursor / preview.steps.length) * 100}%` }}
                />
              </div>
              <span>
                {String(cursor).padStart(2, "0")}{" "}
                <span>/ {preview.steps.length}</span>
              </span>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Playback speed"
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
              </select>
            </div>
            <div className="event-line">
              <span className="event-prefix">
                {cursor
                  ? `R0${last?.robot === "robot-1" ? "1" : "2"} / ${String(last?.step ?? 0).padStart(2, "0")}`
                  : "SYSTEM / 00"}
              </span>
              <span className="event-action">
                {last
                  ? `${last.action}(${Object.values(last.args).join(", ")})`
                  : "Store initialized. The robots are ready."}
              </span>
              <span className="event-outcome">
                {last ? (
                  last.ok ? (
                    <>
                      <Check size={13} /> {last.reason}
                    </>
                  ) : (
                    last.reason
                  )
                ) : (
                  <>
                    <Check size={13} /> Engine ready
                  </>
                )}
              </span>
            </div>
          </section>
          <footer>
            <span>
              <Cuboid size={13} /> AUTOROBOHARNESS{" "}
              <span className="footer-divider">/</span> LEARN TOGETHER. WORK
              BETTER.
            </span>
            <span>
              THE CLOSED LOOP <span className="tiny-dot" /> VERSION 1
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
