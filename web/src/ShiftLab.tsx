import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Box,
  Check,
  Compass,
  Cuboid,
  Focus,
  GitBranch,
  Layers3,
  LoaderCircle,
  Play,
  Radio,
  RotateCcw,
  Store,
  Terminal,
} from "lucide-react";
import {
  createEngine,
  createScenario,
  StoreEngine,
  type Scenario,
  type Task,
  type TrajectoryStep,
} from "../../engine/store.ts";
import {
  api,
  ApiError,
  type BrainGraphData,
  type ShiftInfo,
  type ShiftStep,
  type TaskSpec,
} from "./api.ts";
import { StoreScene } from "./scene/StoreScene.ts";
import BrainGraph from "./BrainGraph.tsx";
import ReviewPanel from "./ReviewPanel.tsx";
import WorkerViews, { ROBOT_NAMES, ROBOT_COLORS } from "./WorkerViews.tsx";
import type { VersionIndex } from "./BrainExplorer.tsx";
import type { SavedTrial } from "./trialTypes.ts";

const DEFAULT_TASKS: TaskSpec[] = [
  { type: "PICK", slot: "A-3-4-1" },
  { type: "RESTOCK", slot: "B-1-3-2" },
  { type: "PICK", slot: "B-3-2-1" },
  { type: "RESTOCK", slot: "A-2-1-2" },
];
function launchScenario(seed: number, tasks: TaskSpec[]) {
  const engine = createEngine(seed, { robotCount: tasks.length });
  tasks.forEach((spec, i) =>
    engine.createTask(`robot-${i + 1}`, spec.type, spec.slot),
  );
  return engine.snapshot();
}
function shiftScenario(
  seed: number,
  tasks: Task[],
  history?: TrajectoryStep[],
) {
  const engine = new StoreEngine(createScenario(seed, tasks.length));
  tasks.forEach((task) => engine.setTask(task));
  if (history?.length && !history.some((step) => step.shoppers))
    engine.scenario.shoppers = {};
  return engine.snapshot();
}
declare global {
  interface Window {
    __AUTO_ROBO_LIVE__?: {
      scene: StoreScene;
      shiftId: () => string | null;
      steps: () => TrajectoryStep[];
    };
  }
}

export default function ShiftLab({ onPreview }: { onPreview: () => void }) {
  const [seed, setSeed] = useState(1);
  const [brainVersion, setBrainVersion] = useState("live");
  const [versions, setVersions] = useState<VersionIndex | null>(null);
  const [specs, setSpecs] = useState<TaskSpec[]>(DEFAULT_TASKS.slice(0, 2));
  const [scenario, setScenario] = useState<Scenario>(() =>
    launchScenario(1, DEFAULT_TASKS.slice(0, 2)),
  );
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [steps, setSteps] = useState<ShiftStep[]>([]);
  const [latest, setLatest] = useState<Record<string, ShiftStep>>({});
  const [animatedCount, setAnimatedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [brain, setBrain] = useState<BrainGraphData | null>(null);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [brainReads, setBrainReads] = useState<string[]>([]);
  const [readEpoch, setReadEpoch] = useState(0);
  const [view, setView] = useState<"perspective" | "overhead" | "workers">(
    "perspective",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRobot, setSelectedRobot] = useState("robot-1");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [replayLabel, setReplayLabel] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StoreScene | null>(null);
  const activeRef = useRef<string | null>(null);
  const stepsRef = useRef<ShiftStep[]>([]);
  const seen = useRef(new Set<string>());
  const queued = useRef(new Set<string>());
  const queues = useRef(new Map<string, Promise<void>>());
  const generation = useRef(0);
  const launchingRef = useRef(false);
  const earlySteps = useRef<ShiftStep[]>([]);
  const finalRef = useRef(new Set<string>());
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const appendRef = useRef<(incoming: ShiftStep[]) => void>(() => {});
  const live = !!shift && shift.status === "running";
  const animating = animatedCount < steps.length;
  const busy = launching || live || animating;

  const loadBrain = async () => {
    try {
      setBrain(await api<BrainGraphData>("/brain"));
      setBrainError(null);
    } catch (e) {
      setBrainError(e instanceof Error ? e.message : "Brain is unavailable");
    }
  };

  useEffect(() => {
    void loadBrain();
    void api<VersionIndex>("/brain/versions")
      .then(setVersions)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let active = true;
    const saved = sessionStorage.getItem("autorobo-active-shift");
    if (saved) {
      void (async () => {
        try {
          const info = await api<ShiftInfo>(
            `/shift/${encodeURIComponent(saved)}`,
          );
          const history = await api<TrajectoryStep[]>(
            `/shift/${encodeURIComponent(saved)}/trajectory`,
          );
          if (!active) return;
          activeRef.current = saved;
          setSeed(info.seed);
          setSpecs(
            info.tasks.map((task) => ({
              type: task.type,
              slot: task.type === "PICK" ? task.source : task.target,
            })),
          );
          const recording = info.trial_id
            ? await api<SavedTrial>(
                `/trials/${encodeURIComponent(info.trial_id)}`,
              )
            : null;
          if (!active) return;
          setScenario(
            recording?.initial ?? shiftScenario(info.seed, info.tasks, history),
          );
          void api<BrainGraphData>(`/brain?v=${info.brain_version}`).then(
            setBrain,
          );
          setShift(info);
          const restored = history.map((step) => ({
            ...step,
            shift_id: saved,
            seed: info.seed,
            brain_version: info.brain_version,
          }));
          seen.current = new Set(
            restored.map((step) => `${step.robot}:${step.step}`),
          );
          stepsRef.current = restored;
          setSteps(restored);
          if (info.status !== "running") finalRef.current.add(saved);
          if (info.status === "error")
            setError(info.error ?? "The shift ended with an error.");
        } catch {
          if (active) {
            sessionStorage.removeItem("autorobo-active-shift");
            setNotice(
              "The saved shift could not be restored. A new shift can be launched.",
            );
          }
        }
      })();
    }
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!activeRef.current) setScenario(launchScenario(seed, specs));
  }, [seed, specs]);

  useEffect(() => {
    if (!host.current) return;
    const token = ++generation.current;
    setReady(false);
    setLatest({});
    setAnimatedCount(0);
    queued.current.clear();
    queues.current.clear();
    let instance: StoreScene;
    try {
      instance = new StoreScene(host.current, scenario);
      sceneRef.current = instance;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The 3D view could not start.");
      return;
    }
    instance.ready
      .then(() => {
        if (generation.current === token) setReady(true);
      })
      .catch((e) => {
        if (generation.current === token)
          setError(
            e instanceof Error ? e.message : "Store assets could not load",
          );
      });
    if (import.meta.env.DEV)
      window.__AUTO_ROBO_LIVE__ = {
        scene: instance,
        shiftId: () => activeRef.current,
        steps: () => stepsRef.current,
      };
    return () => {
      generation.current++;
      instance.dispose();
      sceneRef.current = null;
      delete window.__AUTO_ROBO_LIVE__;
    };
  }, [scenario]);

  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view, scenario]);

  // Each robot has its own promise chain, so robots move concurrently and retain their action order.
  useEffect(() => {
    const instance = sceneRef.current;
    if (!instance) return;
    const token = generation.current;
    for (const step of steps) {
      const key = `${step.robot}:${step.step}`;
      if (queued.current.has(key)) continue;
      queued.current.add(key);
      const chain = (queues.current.get(step.robot) ?? Promise.resolve())
        .then(async () => {
          if (generation.current !== token) return;
          await instance.ready;
          if (generation.current !== token) return;
          await instance.playStep(step, 2);
          if (generation.current !== token) return;
          setLatest((previous) => ({ ...previous, [step.robot]: step }));
          setAnimatedCount((count) => count + 1);
        })
        .catch((e) => {
          if (generation.current === token)
            setError(
              e instanceof Error
                ? e.message
                : "An action could not be animated",
            );
        });
      queues.current.set(step.robot, chain);
    }
  }, [steps, scenario]);

  appendRef.current = (incoming) => {
    if (activeRef.current && finalRef.current.has(activeRef.current)) return;
    const accepted = incoming.filter((step) => {
      if (step.shift_id !== activeRef.current) return false;
      const key = `${step.robot}:${step.step}`;
      if (seen.current.has(key)) return false;
      seen.current.add(key);
      return true;
    });
    if (!accepted.length) return;
    const last = accepted.at(-1)!;
    setBrainReads(last.brain_nodes_read);
    setReadEpoch((n) => n + 1);
    stepsRef.current = [...stepsRef.current, ...accepted];
    setSteps(stepsRef.current);
  };

  refreshRef.current = async () => {
    const id = activeRef.current;
    if (!id) return;
    try {
      const info = await api<ShiftInfo>(`/shift/${id}`);
      if (activeRef.current !== id) return;
      setShift(info);
      if (info.status === "error")
        setError(info.error ?? "The worker stopped with an error.");
      if (info.status !== "running" && !finalRef.current.has(id)) {
        const trajectory = await api<TrajectoryStep[]>(
          `/shift/${id}/trajectory`,
        );
        if (activeRef.current !== id) return;
        const restored = trajectory.map((step) => ({
          ...step,
          shift_id: id,
          seed: info.seed,
          brain_version: info.brain_version,
        }));
        if (
          restored.some(
            (step) => !seen.current.has(`${step.robot}:${step.step}`),
          )
        ) {
          // The saved engine log repairs missed stream messages without playing old actions after new ones.
          seen.current = new Set(
            restored.map((step) => `${step.robot}:${step.step}`),
          );
          stepsRef.current = restored;
          setScenario(shiftScenario(info.seed, info.tasks, trajectory));
          setSteps(restored);
          setNotice(
            "The saved trajectory filled a stream gap. The shift is replaying in full.",
          );
        }
        finalRef.current.add(id);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        finalRef.current.add(id);
        const message =
          "The server restarted before this shift was saved. A new shift can be launched.";
        setShift((previous) =>
          previous
            ? { ...previous, status: "error", error: message }
            : previous,
        );
        setError(message);
      } else
        setNotice(
          e instanceof Error
            ? e.message
            : "The server could not be reached. Reconnecting…",
        );
    }
  };

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onopen = () => {
      setConnected(true);
      void refreshRef.current();
    };
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      try {
        const step = JSON.parse(event.data) as ShiftStep;
        if (launchingRef.current && !activeRef.current)
          earlySteps.current.push(step);
        else appendRef.current([step]);
      } catch {
        setNotice(
          "A stream message could not be read. The saved trajectory will be checked at shift end.",
        );
      }
    };
    source.addEventListener("brain_read", (event) => {
      try {
        const read = JSON.parse((event as MessageEvent).data);
        if (read.shift_id === activeRef.current) {
          setBrainReads(read.node_ids);
          setReadEpoch((n) => n + 1);
        }
      } catch {
        /* A malformed read pulse cannot change the engine state. */
      }
    });
    source.addEventListener("shift_done", () => {
      void refreshRef.current();
    });
    source.addEventListener("brain_version", () => {
      void loadBrain();
    });
    const poll = window.setInterval(() => {
      void refreshRef.current();
    }, 2500);
    return () => {
      source.close();
      clearInterval(poll);
    };
  }, []);

  const launch = async () => {
    if (busy || !connected || !ready) return;
    setLaunching(true);
    launchingRef.current = true;
    earlySteps.current = [];
    setError(null);
    setNotice(null);
    seen.current.clear();
    stepsRef.current = [];
    setSteps([]);
    try {
      const result = await api<{
        shift_id: string;
        brain_version: number;
        tasks: Task[];
      }>("/shift", {
        method: "POST",
        body: JSON.stringify({
          seed,
          tasks: specs,
          brain: brainVersion === "live" ? "live" : Number(brainVersion),
        }),
      });
      activeRef.current = result.shift_id;
      sessionStorage.setItem("autorobo-active-shift", result.shift_id);
      setScenario(shiftScenario(seed, result.tasks));
      setShift({
        ...result,
        seed,
        status: "running",
        scores: [],
        llm: { calls: 0, prompt_tokens: 0, completion_tokens: 0 },
      });
      setBrainReads([]);
      void api<BrainGraphData>(`/brain?v=${result.brain_version}`).then(
        setBrain,
      );
      setView("perspective");
      appendRef.current(earlySteps.current);
      void refreshRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The shift could not start.");
    } finally {
      setLaunching(false);
      launchingRef.current = false;
      earlySteps.current = [];
    }
  };

  const newShift = () => {
    if (busy) return;
    sessionStorage.removeItem("autorobo-active-shift");
    activeRef.current = null;
    seen.current.clear();
    stepsRef.current = [];
    setSteps([]);
    setShift(null);
    setLatest({});
    setBrainReads([]);
    setError(null);
    setNotice(null);
    setSelectedRobot("robot-1");
    setReviewOpen(false);
    setReplayLabel(null);
    setScenario(launchScenario(seed, specs));
  };
  const changeTask = (i: number, patch: Partial<TaskSpec>) =>
    setSpecs((current) =>
      current.map((spec, index) =>
        i === index ? { ...spec, ...patch } : spec,
      ),
    );
  const selectedLast = latest[selectedRobot];
  const selectedTask = Object.values(scenario.tasks).find(
    (task) => task.robot === selectedRobot,
  );
  const selectedState =
    selectedLast?.robot_state ?? scenario.robots[selectedRobot];
  const selectedSteps = steps.filter((step) => step.robot === selectedRobot);
  const lastStep = steps.at(-1);
  const slots = Object.values(scenario.layout.slots).filter(
    (slot) => slot.aisle !== "backroom",
  );
  const finalScore = shift?.scores.find((s) => s.task_id === selectedTask?.id);
  const activeScene = (next: "perspective" | "overhead" | "workers") => {
    sceneRef.current?.setView(next);
    setView(next);
  };
  const replayFailure = async (robotId: string, stepNumber: number) => {
    const history = stepsRef.current,
      index = history.findIndex(
        (step) => step.robot === robotId && step.step === stepNumber,
      );
    if (index < 0 || !sceneRef.current) {
      setNotice("The cited step is not in this shift trajectory.");
      return;
    }
    const instance = sceneRef.current;
    await instance.ready;
    instance.seekToStep(history, index - 1);
    setSelectedRobot(robotId);
    setReplayLabel(`${robotId} · Step ${stepNumber}`);
    host.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    await instance.playStep(history[index]);
    setLatest((previous) => ({ ...previous, [robotId]: history[index] }));
  };
  const endReplay = () => {
    sceneRef.current?.seekToStep(stepsRef.current, stepsRef.current.length - 1);
    setLatest(
      Object.fromEntries(stepsRef.current.map((step) => [step.robot, step])),
    );
    setReplayLabel(null);
  };

  return (
    <div className="app-shell">
      <aside className="rail">
        <a className="brand-mark" href="/" aria-label="AutoRoboHarness home">
          <Cuboid size={25} strokeWidth={1.6} />
        </a>
        <span className="rail-divider" />
        <button className="rail-icon active" aria-label="Store lab">
          <Store size={21} />
        </button>
        <span className="rail-spacer" />
        <div className="version-badge">V2</div>
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
            <span className="slash">/</span> THE CLOSED LOOP
          </div>
          <div className="topbar-right">
            <button className="outline-tag" disabled={busy} onClick={onPreview}>
              MOTION PREVIEW ↗
            </button>
            <span className={`connection-label ${connected ? "" : "offline"}`}>
              <span className="status-dot" />
              {connected ? "SERVER CONNECTED" : "CONNECTING TO SERVER"}
            </span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                WORKSPACE / {shift ? "LIVE SHIFT" : "LAUNCH A SHIFT"}
              </div>
              <h1>
                A little store. A lot to learn<span>.</span>
              </h1>
              <p>
                {shift
                  ? `Brain v${shift.brain_version} · Scenario ${String(shift.seed).padStart(2, "0")} · ${live ? "Workers are choosing actions on Crusoe." : animating ? "The robots are finishing their moves." : "Every action is saved for review."}`
                  : "One shared brain. Up to four robots. A new lesson every shift."}
              </p>
            </div>
            <span className="shift-status">
              <span className="status-dot" />
              {launching
                ? "STARTING"
                : live
                  ? "SHIFT IN PROGRESS"
                  : animating
                    ? "PLAYING TRAJECTORY"
                    : shift?.status === "error"
                      ? "SHIFT STOPPED"
                      : shift
                        ? "SHIFT COMPLETE"
                        : "READY WHEN YOU ARE"}
            </span>
          </section>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="inline-notice" role="status">
              {notice}
            </div>
          )}
          <div className="live-layout">
            <div className="live-main">
              <section className="store-card">
                <div className="card-toolbar">
                  <div>
                    <span className="live-dot" />
                    <strong>Store environment</strong>
                    <span className="subtle-tag">
                      {shift ? "LIVE" : "READY"}
                    </span>
                  </div>
                  <div className="view-switch">
                    <button
                      className={view === "perspective" ? "selected" : ""}
                      onClick={() => activeScene("perspective")}
                    >
                      <Cuboid size={14} />
                      3D view
                    </button>
                    <button
                      className={view === "overhead" ? "selected" : ""}
                      onClick={() => activeScene("overhead")}
                    >
                      <Layers3 size={14} />
                      Top view
                    </button>
                    <button
                      className={view === "workers" ? "selected" : ""}
                      onClick={() => activeScene("workers")}
                    >
                      <Focus size={14} />
                      Worker views
                    </button>
                  </div>
                </div>
                <div
                  className={`viewport-wrap live-viewport ${view === "workers" ? "worker-viewport" : ""}`}
                  style={
                    view === "workers"
                      ? ({
                          "--worker-count": specs.length,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  <div className="scene-host" ref={host} />
                  {view === "workers" && (
                    <WorkerViews
                      scenario={scenario}
                      steps={steps}
                      latest={latest}
                    />
                  )}
                  <div className="viewport-top">
                    <span className="map-label">
                      <span className="status-dot" />
                      STORE WING A
                    </span>
                    <span className="map-label secondary">
                      2 AISLES · 4 LEVELS
                    </span>
                  </div>
                  {!ready && !error && (
                    <div className="loading">
                      <LoaderCircle className="spin" size={20} />
                      Preparing the store…
                    </div>
                  )}
                  <div className="viewport-controls">
                    <button
                      aria-label="Reset camera"
                      onClick={() => activeScene("perspective")}
                    >
                      <Compass size={17} />
                    </button>
                    <button
                      aria-label="Focus selected robot"
                      onClick={() =>
                        sceneRef.current?.focusRobot(selectedRobot)
                      }
                    >
                      <Focus size={17} />
                    </button>
                  </div>
                  <div className="viewport-bottom">
                    <span>
                      <span className="legend-square orange" />
                      R01
                      {specs.length > 1 && (
                        <>
                          <span className="legend-square blue" />
                          R02
                        </>
                      )}
                    </span>
                    <span>Drag to orbit · Scroll to zoom</span>
                  </div>
                </div>
                <div className="store-caption">
                  <div>
                    <Radio size={13} />
                    <span>
                      {replayLabel
                        ? `REPLAY / ${replayLabel}`
                        : shift
                          ? `${animatedCount} / ${steps.length} actions animated`
                          : "The engine and view share the same seeded world."}
                    </span>
                    {replayLabel && (
                      <button className="return-final" onClick={endReplay}>
                        Return to final state
                      </button>
                    )}
                  </div>
                  <span
                    className="cache-share"
                    title="Provider-reported cache share for worker calls that include cache usage"
                  >
                    {shift
                      ? `${shift.llm.calls} calls · ${shift.cache_share != null || shift.llm.cache_share != null ? `${((shift.cache_share ?? shift.llm.cache_share ?? 0) * 100).toFixed(1)}% cache` : shift.llm.calls > 0 ? "Cache not reported" : "Cache awaiting usage"}`
                      : "KENNEY · CC0"}
                  </span>
                </div>
              </section>
              <BrainGraph
                data={brain}
                error={brainError}
                readIds={brainReads}
                epoch={readEpoch}
              />
            </div>
            <aside className="shift-sidebar">
              {!shift ? (
                <section className="launch-card">
                  <div className="section-title">
                    SHIFT SETUP<span>01</span>
                  </div>
                  <h2>Meet your next shift.</h2>
                  <p className="launch-intro">
                    Choose the team and their tasks.
                    <br />
                    The robots take it from here.
                  </p>
                  <label
                    className="historical-brain-label"
                    htmlFor="shift-brain"
                  >
                    Brain version
                    <select
                      id="shift-brain"
                      value={brainVersion}
                      disabled={launching}
                      onChange={(e) => setBrainVersion(e.target.value)}
                    >
                      <option value="live">
                        Live brain{versions ? ` · v${versions.live}` : ""}
                      </option>
                      {versions?.versions.map((v) => (
                        <option key={v.v} value={v.v}>
                          v{v.v} · {v.status}
                        </option>
                      ))}
                    </select>
                    <small>
                      Runs use this snapshot. The live brain and saved versions
                      stay unchanged.
                    </small>
                  </label>
                  <div className="form-row">
                    <label htmlFor="robot-count">
                      Robots
                      <select
                        id="robot-count"
                        disabled={launching}
                        value={specs.length}
                        onChange={(e) => {
                          const count = Number(e.target.value);
                          setSpecs((current) =>
                            Array.from(
                              { length: count },
                              (_, i) => current[i] ?? DEFAULT_TASKS[i],
                            ),
                          );
                          setSelectedRobot("robot-1");
                        }}
                      >
                        <option value={1}>1 robot</option>
                        <option value={2}>2 robots</option>
                        <option value={3}>3 robots</option>
                        <option value={4}>4 robots</option>
                      </select>
                    </label>
                    <label htmlFor="training-seed">
                      Training seed
                      <select
                        id="training-seed"
                        value={seed}
                        disabled={launching}
                        onChange={(e) => setSeed(Number(e.target.value))}
                      >
                        {Array.from({ length: 20 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {String(i + 1).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {specs.map((spec, i) => (
                    <div className="task-form" key={i}>
                      <div className="task-form-title">
                        <span className={`robot-tab-dot ${ROBOT_COLORS[i]}`} />
                        R0{i + 1}
                        <span>{ROBOT_NAMES[i].toUpperCase()}</span>
                      </div>
                      <label>
                        Task
                        <select
                          aria-label={`Robot ${i + 1} task`}
                          value={spec.type}
                          disabled={launching}
                          onChange={(e) =>
                            changeTask(i, {
                              type: e.target.value as TaskSpec["type"],
                            })
                          }
                        >
                          <option value="PICK">PICK · Shelf to tote</option>
                          <option value="RESTOCK">
                            RESTOCK · Backroom to shelf
                          </option>
                        </select>
                      </label>
                      <label>
                        Shelf slot
                        <select
                          aria-label={`Robot ${i + 1} slot`}
                          value={spec.slot}
                          disabled={launching}
                          onChange={(e) =>
                            changeTask(i, { slot: e.target.value })
                          }
                        >
                          {slots.map((slot) => (
                            <option key={slot.id} value={slot.id}>
                              {slot.id} · Level {slot.level}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))}
                  <div className="brain-version-label">
                    <GitBranch size={14} />
                    <span>Shared brain</span>
                    <strong>
                      {brain ? `v${brain.version}` : "Connecting…"}
                    </strong>
                  </div>
                  <button
                    className="launch-button"
                    disabled={!ready || !connected || launching}
                    onClick={() => void launch()}
                  >
                    {launching ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Play size={13} fill="currentColor" />
                    )}{" "}
                    {launching ? "Starting shift…" : "Launch shift"}
                    <ArrowRight size={15} />
                  </button>
                  <p className="launch-footnote">
                    Workers run on Crusoe Managed Inference.
                    <br />
                    Held-out seeds are reserved for the gate.
                  </p>
                </section>
              ) : (
                <section className="live-stats-card">
                  <div className="section-title">
                    THE TEAM
                    <span>{specs.length.toString().padStart(2, "0")}</span>
                  </div>
                  <div className="robot-tabs">
                    {Object.values(scenario.robots).map((robot, i) => (
                      <button
                        key={robot.id}
                        className={selectedRobot === robot.id ? "chosen" : ""}
                        onClick={() => setSelectedRobot(robot.id)}
                      >
                        <span className={`robot-tab-dot ${ROBOT_COLORS[i]}`} />
                        R0{i + 1}
                      </button>
                    ))}
                  </div>
                  <div className="live-robot-heading">
                    <h2>
                      {ROBOT_NAMES[Number(selectedRobot.split("-")[1]) - 1]}{" "}
                      <span>
                        {selectedRobot.split("-")[1].padStart(2, "0")}
                      </span>
                    </h2>
                    <span>
                      {finalScore
                        ? finalScore.complete
                          ? "TASK PASSED"
                          : "NEEDS REVIEW"
                        : "WORKING"}
                    </span>
                  </div>
                  <div className="task-card">
                    <span className="eyebrow">CURRENT TASK</span>
                    <div>
                      <span className="task-type">{selectedTask?.type}</span>
                      <strong>
                        {selectedTask
                          ? scenario.items[selectedTask.item_id].name
                          : "Waiting"}
                      </strong>
                      <Box size={16} />
                    </div>
                    <p>
                      {selectedTask?.source} → {selectedTask?.target}
                    </p>
                  </div>
                  <div className="physical-stats">
                    <div>
                      <span>Action</span>
                      <strong>
                        {selectedLast?.step ?? 0}
                        <small> / 30 max</small>
                      </strong>
                    </div>
                    <div>
                      <span>Torso level</span>
                      <strong>
                        {selectedState?.torso_level ?? 1}
                        <small> / 4</small>
                      </strong>
                    </div>
                    <div>
                      <span>Waypoint</span>
                      <strong>{selectedState?.waypoint ?? "backroom"}</strong>
                    </div>
                    <div>
                      <span>Gripper</span>
                      <strong>
                        {selectedState?.holding ? "Holding" : "Empty"}
                      </strong>
                    </div>
                  </div>
                  <div className="section-title">
                    RECENT ACTIONS
                    <span>
                      {selectedSteps.length.toString().padStart(2, "0")}
                    </span>
                  </div>
                  <ol className="step-list">
                    {selectedSteps.slice(-12).map((step) => (
                      <li
                        key={step.step}
                        className={step.ok ? "" : "refused-step"}
                      >
                        <span>{String(step.step).padStart(2, "0")}</span>
                        <div>
                          <strong>{step.action}</strong>
                          <p>{step.reason}</p>
                        </div>
                        {step.ok ? <Check size={11} /> : <span>!</span>}
                      </li>
                    ))}
                    {!selectedSteps.length && (
                      <li className="waiting-step">
                        <LoaderCircle className="spin" size={13} />
                        The worker is reading its brain…
                      </li>
                    )}
                  </ol>
                  {!busy && (
                    <button className="new-shift-button" onClick={newShift}>
                      <RotateCcw size={14} />
                      Set up another shift
                    </button>
                  )}
                </section>
              )}
              <div className="shift-principle">
                <span>01 / THE CLOSED LOOP</span>
                <p>
                  The robots work.
                  <br />
                  The harness learns.
                  <br />
                  <strong>The next shift gets better.</strong>
                </p>
              </div>
            </aside>
          </div>
          {shift && (
            <section className="shift-summary">
              <Terminal size={17} />
              <div>
                <strong>
                  {live
                    ? "The shift is running."
                    : animating
                      ? "The engine has finished. The view is catching up."
                      : shift.status === "error"
                        ? "The shift stopped before it finished."
                        : "The shift is ready for review."}
                </strong>
                <p>
                  {live
                    ? "Every decision is made by a worker agent. Every result comes from the store engine."
                    : `${shift.scores.filter((s) => s.complete).length} of ${shift.tasks.length} tasks passed with no refused actions. ${steps.filter((s) => !s.ok).length} actions were refused.`}
                </p>
              </div>
              {shift.status === "done" && (
                <button
                  className="review-shift-button"
                  disabled={animating}
                  onClick={() => setReviewOpen(!reviewOpen)}
                >
                  {reviewOpen ? "Close review" : "Review shift"}
                  <ArrowRight size={13} />
                </button>
              )}
            </section>
          )}
          {lastStep && (
            <div className="live-event-line">
              <span className="event-prefix">
                {lastStep.robot.toUpperCase()} /{" "}
                {String(lastStep.step).padStart(2, "0")}
              </span>
              <span>
                {lastStep.action}({Object.values(lastStep.args).join(", ")})
              </span>
              <span className={lastStep.ok ? "good" : "bad"}>
                {lastStep.reason}
              </span>
            </div>
          )}
          {reviewOpen && shift?.status === "done" && (
            <ReviewPanel
              shiftId={shift.shift_id}
              onReplay={(robot, step) => {
                void replayFailure(robot, step);
              }}
              onClose={() => setReviewOpen(false)}
              onBrainUpdated={() => {
                void loadBrain();
              }}
            />
          )}
          <footer>
            <span>
              <Cuboid size={13} />
              AUTOROBOHARNESS<span className="footer-divider">/</span>LEARN
              TOGETHER. WORK BETTER.
            </span>
            <span>
              THE CLOSED LOOP
              <span className="tiny-dot" />
              VERSION 2
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
