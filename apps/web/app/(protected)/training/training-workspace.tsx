"use client";

import { useEffect, useMemo, useState } from "react";
import type { TrainingDashboard } from "@fitcrew/db";

type Props = { tenantId: string; dashboard: TrainingDashboard; canEdit: boolean };
type SetRow = {
  id: string;
  weight: string;
  reps: string;
  complete: boolean;
  note: string;
};
type WorkoutExercise = { id: string; name: string; sets: SetRow[] };
type SessionRow = TrainingDashboard["sessions"][number];
const makeSet = (): SetRow => ({
  id: `${Date.now()}-${Math.random()}`,
  weight: "",
  reps: "",
  complete: false,
  note: "",
});
const cleanWeight = (value: string) => {
  const [whole = "", ...decimal] = value.replace(/[^\d.]/g, "").split(".");
  return `${whole.slice(0, 4)}${decimal.length ? `.${decimal.join("").slice(0, 2)}` : ""}`;
};
const cleanReps = (value: string) => value.replace(/\D/g, "").slice(0, 3);
const isValidWeight = (value: string) =>
  /^\d{1,4}(\.\d{1,2})?$/.test(value) && Number(value) <= 1000;
const isValidReps = (value: string) =>
  /^\d{1,3}$/.test(value) && Number(value) <= 999;
const setValidationMessage = (set: SetRow) =>
  !isValidWeight(set.weight) || !isValidReps(set.reps)
    ? "Enter a valid weight (0–1000 kg) and reps (0–999) before completing the set."
    : null;

export function TrainingWorkspace({ tenantId, dashboard, canEdit }: Props) {
  if (!canEdit) return <ReadOnlyTrainingWorkspace sessions={dashboard.sessions} />;
  return <EditableTrainingWorkspace tenantId={tenantId} dashboard={dashboard} />;
}

function ReadOnlyTrainingWorkspace({ sessions }: { sessions: readonly SessionRow[] }) {
  return (
    <div className="fitnotes-workspace training-read-only">
      <section className="history-launch">
        <div>
          <span>REVIEW TRAINING</span>
          <p>Browse completed workouts by day and client.</p>
        </div>
      </section>
      <GlobalWorkoutHistory sessions={sessions} />
    </div>
  );
}

function EditableTrainingWorkspace({ tenantId, dashboard }: Omit<Props, "canEdit">) {
  const [clientId, setClientId] = useState(
    dashboard.clients[0]?.clientId ?? "",
  );
  const [workspace, setWorkspace] = useState<TrainingDashboard>(dashboard);
  const [sessions, setSessions] = useState<readonly SessionRow[]>(
    dashboard.sessions,
  );
  const [workout, setWorkout] = useState<WorkoutExercise[]>([]);
  const [activeId, setActiveId] = useState("");
  const [tab, setTab] = useState<"log" | "history" | "graph">("log");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [restDefault, setRestDefault] = useState(dashboard.defaultRestSeconds);
  const [rest, setRest] = useState(dashboard.defaultRestSeconds);
  const [running, setRunning] = useState(false);
  const [restDefaultState, setRestDefaultState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [status, setStatus] = useState("");
  const [finishState, setFinishState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [invalidSetIds, setInvalidSetIds] = useState<string[]>([]);
  const [touchedFields, setTouchedFields] = useState<string[]>([]);
  const [globalHistoryOpen, setGlobalHistoryOpen] = useState(false);
  const activeClient = workspace.clients.find(
    (client) => client.clientId === clientId,
  );
  const active =
    workout.find((exercise) => exercise.id === activeId) ?? workout[0];
  const filtered = useMemo(
    () =>
      workspace.exercises
        .filter((e) =>
          query
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .every((term) =>
              `${e.name} ${e.muscleGroup ?? ""}`.toLowerCase().includes(term),
            ),
        )
        .slice(0, 36),
    [workspace.exercises, query],
  );
  const completed = workout
    .flatMap((exercise) => exercise.sets)
    .filter((set) => set.complete).length;
  const totalSets = workout.reduce(
    (sum, exercise) => sum + exercise.sets.length,
    0,
  );
  useEffect(() => {
    if (!running || rest <= 0) return;
    const id = window.setInterval(
      () => setRest((v) => Math.max(0, v - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [running, rest]);
  useEffect(() => {
    if (!clientId) return;
    let activeRequest = true;
    void fetch(`/api/training/draft?tenantId=${tenantId}&clientId=${clientId}`)
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as {
              exercises?: WorkoutExercise[];
              activeExerciseId?: string | null;
            } | null)
          : null,
      )
      .then((draft) => {
        const first = draft?.exercises?.[0];
        if (activeRequest && first) {
          setWorkout(draft.exercises ?? []);
          setActiveId(draft.activeExerciseId ?? first.id);
          setStatus("Restored unfinished workout.");
        }
      });
    return () => {
      activeRequest = false;
    };
  }, [tenantId, clientId]);
  async function switchClient(next: string) {
    setClientId(next);
    setWorkout([]);
    setActiveId("");
    const response = await fetch(
      `/api/training/dashboard?tenantId=${tenantId}&clientId=${next}`,
    );
    if (response.ok) {
      const data = (await response.json()) as TrainingDashboard;
      setWorkspace(data);
      setSessions(data.sessions);
    }
  }
  function addExercise(name: string) {
    const existing = workout.find((e) => e.name === name);
    if (existing) {
      setActiveId(existing.id);
      setPickerOpen(false);
      return;
    }
    const id = `${Date.now()}-${name}`;
    setWorkout((current) => [...current, { id, name, sets: [makeSet()] }]);
    setActiveId(id);
    setPickerOpen(false);
    setQuery("");
  }
  function addCustomExercise(exercise: {
    id: string;
    name: string;
    muscleGroup: string;
    tenantId: string;
  }) {
    setWorkspace((current) => ({
      ...current,
      exercises: current.exercises.some((item) => item.id === exercise.id)
        ? current.exercises
        : [...current.exercises, exercise].sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
    }));
    addExercise(exercise.name);
  }
  function updateSet(id: string, patch: Partial<SetRow>) {
    if (!active) return;
    setWorkout((current) =>
      current.map((e) =>
        e.id !== active.id
          ? e
          : {
              ...e,
              sets: e.sets.map((s) => (s.id === id ? { ...s, ...patch } : s)),
            },
      ),
    );
  }
  function touchField(id: string, field: "weight" | "reps") {
    const key = `${id}:${field}`;
    setTouchedFields((current) =>
      current.includes(key) ? current : [...current, key],
    );
  }
  function addSet() {
    if (active)
      setWorkout((current) =>
        current.map((e) =>
          e.id === active.id ? { ...e, sets: [...e.sets, makeSet()] } : e,
        ),
      );
  }
  function removeSet(id: string) {
    if (active && active.sets.length > 1)
      setWorkout((current) =>
        current.map((e) =>
          e.id === active.id
            ? { ...e, sets: e.sets.filter((s) => s.id !== id) }
            : e,
        ),
      );
  }
  function toggleComplete(id: string) {
    const set = active?.sets.find((s) => s.id === id);
    if (set) {
      const issue = !set.complete ? setValidationMessage(set) : null;
      if (issue) {
        setInvalidSetIds((current) =>
          current.includes(id) ? current : [...current, id],
        );
        setStatus(issue);
        return;
      }
      setInvalidSetIds((current) => current.filter((setId) => setId !== id));
      updateSet(id, { complete: !set.complete });
      if (!set.complete) {
        setRest(restDefault);
        setRunning(true);
      }
    }
  }
  async function saveDraft(): Promise<boolean> {
    if (!workout.length) {
      setStatus("Add an exercise before saving a draft.");
      return false;
    }
    try {
      const response = await fetch("/api/training/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId,
          clientId,
          exercises: workout,
          activeExerciseId: activeId || null,
        }),
      });
      if (response.ok) {
        setStatus("Draft saved to FitCrew.");
        return true;
      }
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setStatus(result?.error ?? "Draft could not be saved.");
      return false;
    } catch {
      setStatus(
        "Draft could not be saved. Check your connection and try again.",
      );
      return false;
    }
  }
  async function saveWorkout(): Promise<boolean> {
    if (!activeClient || !workout.length) {
      setStatus("Add an exercise before saving.");
      return false;
    }
    const invalidSets = workout.flatMap((exercise) =>
      exercise.sets
        .filter((set) => setValidationMessage(set))
        .map((set) => set.id),
    );
    const invalidExercise = workout.find((exercise) =>
      exercise.sets.some((set) => setValidationMessage(set)),
    );
    if (invalidExercise) {
      setInvalidSetIds(invalidSets);
      setActiveId(invalidExercise.id);
      setTab("log");
      setStatus(
        `Complete valid kg and reps for every set in ${invalidExercise.name} before finishing.`,
      );
      return false;
    }
    const exercises = workout.map((e) => ({
      name: e.name,
      sets: String(e.sets.length),
      reps: e.sets.map((s) => `${s.weight}×${s.reps}`).join(", "),
    }));
    const workoutNotes = workout
      .flatMap((exercise) =>
        exercise.sets.flatMap((set, index) =>
          set.note.trim()
            ? [`${exercise.name} · Set ${index + 1}: ${set.note.trim()}`]
            : [],
        ),
      )
      .join("\n");
    const sessionNotes = workoutNotes || "Logged from workout board";
    const now = new Date();
    try {
      const response = await fetch("/api/training/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId,
          clientId,
          sessionDate: now.toISOString().slice(0, 10),
          startTime: now.toTimeString().slice(0, 5),
          exercises,
          notes: sessionNotes,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(result.error ?? "Workout could not be saved.");
        return false;
      }
      setSessions((current) => [
        {
          id: `pending-${Date.now()}`,
          clientId,
          clientName: activeClient.name,
          sessionDate: now.toISOString().slice(0, 10),
          startTime: now.toTimeString().slice(0, 5),
          endTime: null,
          exerciseCount: exercises.length,
          exercises,
          notes: sessionNotes,
        },
        ...current,
      ]);
      setStatus("Workout saved to client history.");
      setWorkout([]);
      setActiveId("");
      setInvalidSetIds([]);
      return true;
    } catch {
      setStatus(
        "Workout could not be saved. Check your connection and try again.",
      );
      return false;
    }
  }
  async function handleFinish() {
    setFinishState("saving");
    const saved = await saveWorkout();
    setFinishState(saved ? "saved" : "error");
    if (saved) window.setTimeout(() => setFinishState("idle"), 2400);
  }
  async function saveRestDefault() {
    setRestDefaultState("saving");
    try {
      const response = await fetch("/api/training/rest-default", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId, defaultRestSeconds: restDefault }),
      });
      if (!response.ok) throw new Error("Could not save rest default");
      const result = (await response.json()) as { defaultRestSeconds: number };
      setRestDefault(result.defaultRestSeconds);
      setRest(result.defaultRestSeconds);
      setRunning(false);
      setRestDefaultState("saved");
      window.setTimeout(() => setRestDefaultState("idle"), 1800);
    } catch {
      setRestDefaultState("error");
    }
  }
  return (
    <div className="fitnotes-workspace">
      <section className="history-launch">
        <div>
          <span>REVIEW TRAINING</span>
          <p>Browse completed workouts by day and client.</p>
        </div>
        <button
          className={`global-history-toggle ${globalHistoryOpen ? "open" : ""}`}
          onClick={() => setGlobalHistoryOpen((open) => !open)}
          aria-expanded={globalHistoryOpen}
          aria-controls="global-workout-history"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 2v3M17 2v3M3.5 9h17M5.5 4.5h13A1.5 1.5 0 0 1 20 6v12.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V6a1.5 1.5 0 0 1 1.5-1.5ZM8 13h3m2 0h3M8 16.5h3" />
          </svg>
          <span>{globalHistoryOpen ? "Close history" : "Workout history"}</span>
          <b aria-hidden="true">{globalHistoryOpen ? "×" : "›"}</b>
        </button>
      </section>
      {globalHistoryOpen && <GlobalWorkoutHistory sessions={sessions} />}
      <section className="fitnotes-topbar">
        <div className="fitnotes-client">
          <span>CLIENT</span>
          <select
            value={clientId}
            onChange={(e) => void switchClient(e.target.value)}
          >
            {workspace.clients.map((c) => (
              <option key={c.clientId} value={c.clientId}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="workout-progress">
          <strong>
            {completed}/{totalSets}
          </strong>
          <span>sets complete</span>
        </div>
        <button
          className={`fitnotes-save ${finishState}`}
          onClick={() => void handleFinish()}
          disabled={!clientId || finishState === "saving"}
          aria-live="polite"
        >
          {finishState === "saving" ? (
            <>
              <span className="save-spinner" aria-hidden="true" />
              Finishing…
            </>
          ) : finishState === "saved" ? (
            <>
              <span className="save-check" aria-hidden="true">
                ✓
              </span>
              Workout saved
            </>
          ) : finishState === "error" ? (
            "Try finishing again"
          ) : (
            "Finish workout"
          )}
        </button>
      </section>
      {status ? (
        <p className="fitnotes-status" role="status">
          {status}
        </p>
      ) : null}
      <div className="fitnotes-layout">
        <aside className="exercise-rail">
          <div className="rail-title">
            <span>WORKOUT</span>
            <button
              aria-label="Add exercise"
              onClick={() => setPickerOpen(true)}
            >
              +
            </button>
          </div>
          {workout.length === 0 ? (
            <button
              className="empty-workout"
              onClick={() => setPickerOpen(true)}
            >
              + Add your first exercise
            </button>
          ) : (
            <>
              {workout.map((e, i) => (
                <button
                  className={`rail-exercise ${active?.id === e.id ? "active" : ""}`}
                  key={e.id}
                  onClick={() => setActiveId(e.id)}
                >
                  <span className="exercise-index">{i + 1}</span>
                  <span>
                    {e.name}
                    <small>
                      {e.sets.filter((s) => s.complete).length}/{e.sets.length}{" "}
                      sets
                    </small>
                  </span>
                </button>
              ))}
              <button className="rail-add" onClick={() => setPickerOpen(true)}>
                + Add exercise
              </button>
            </>
          )}
        </aside>
        <main className="training-board">
          {!active ? (
            <EmptyBoard open={() => setPickerOpen(true)} />
          ) : (
            <>
              <header className="exercise-header">
                <div>
                  <p>ACTIVE EXERCISE</p>
                  <h1>{active.name}</h1>
                  <span>
                    Tap a field to edit · completed sets start rest
                    automatically
                  </span>
                </div>
                <button className="more-button">•••</button>
              </header>
              <nav className="training-tabs">
                <button
                  className={tab === "log" ? "selected" : ""}
                  onClick={() => setTab("log")}
                >
                  Log
                </button>
                <button
                  className={tab === "history" ? "selected" : ""}
                  onClick={() => setTab("history")}
                >
                  History
                </button>
                <button
                  className={tab === "graph" ? "selected" : ""}
                  onClick={() => setTab("graph")}
                >
                  Graph
                </button>
              </nav>
              {tab === "log" && (
                <LogView
                  active={active}
                  update={updateSet}
                  touch={touchField}
                  toggle={toggleComplete}
                  remove={removeSet}
                  add={addSet}
                  save={saveDraft}
                  invalidSetIds={invalidSetIds}
                  touchedFields={touchedFields}
                />
              )}
              {tab === "history" && <HistoryView sessions={sessions} />}
              {tab === "graph" && (
                <GraphView sessions={sessions} exercise={active.name} />
              )}
            </>
          )}
        </main>
        <aside className="tools-rail">
          <section className="rest-card">
            <div className="rest-card-heading">
              <span>REST TIMER</span>
              <small>{running ? "Resting now" : rest === 0 ? "Rest complete" : "Ready"}</small>
            </div>
            <strong className="rest-time" aria-live="polite">
                {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, "0")}
            </strong>
            <button
              className="rest-primary"
              onClick={() => {
                if (rest === 0) setRest(restDefault);
                setRunning((v) => !v);
              }}
            >
              {running ? "Pause" : rest === 0 ? "Reset" : "Start"}
            </button>
            <div className="timer-controls">
              <button onClick={() => setRest((v) => Math.max(0, v - 15))}>
                −15
              </button>
              <button onClick={() => setRest((v) => v + 15)}>+15</button>
              <button onClick={() => { setRest(restDefault); setRunning(false); }}>Reset</button>
            </div>
            <div className="rest-default">
              <label htmlFor="rest-default">Default rest</label>
              <select id="rest-default" value={restDefault} onChange={(event) => { setRestDefault(Number(event.target.value)); setRestDefaultState("idle"); }}>
                {[30, 45, 60, 75, 90, 120, 150, 180, 240, 300].map((seconds) => <option key={seconds} value={seconds}>{formatRestDuration(seconds)}</option>)}
              </select>
              <button onClick={() => void saveRestDefault()} disabled={restDefaultState === "saving"} aria-live="polite">
                {restDefaultState === "saving" ? "Saving…" : restDefaultState === "saved" ? "Saved ✓" : restDefaultState === "error" ? "Try again" : "Set default"}
              </button>
            </div>
          </section>
          <section className="quick-tools">
            <p>TOOLS</p>
            <button>
              1RM calculator <b>›</b>
            </button>
            <button>
              Plate calculator <b>›</b>
            </button>
            <button>
              Exercise notes <b>›</b>
            </button>
          </section>
          <section className="today-card">
            <p>TODAY</p>
            <strong>{workout.length} exercises</strong>
            <span>{totalSets} planned sets</span>
            <div>
              <i
                style={{
                  width: `${totalSets ? (completed / totalSets) * 100 : 0}%`,
                }}
              />
            </div>
          </section>
        </aside>
      </div>
      {pickerOpen && (
        <Picker
          tenantId={tenantId}
          query={query}
          setQuery={setQuery}
          exercises={filtered}
          add={addExercise}
          addCustom={addCustomExercise}
          close={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
function EmptyBoard({ open }: { open: () => void }) {
  return (
    <section className="board-empty">
      <div className="empty-mark">+</div>
      <h1>Start a workout</h1>
      <p>Add an exercise to build the client’s session one set at a time.</p>
      <button onClick={open}>Add exercise</button>
    </section>
  );
}
function LogView({
  active,
  update,
  touch,
  toggle,
  remove,
  add,
  save,
  invalidSetIds,
  touchedFields,
}: {
  active: WorkoutExercise;
  update: (id: string, patch: Partial<SetRow>) => void;
  touch: (id: string, field: "weight" | "reps") => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  add: () => void;
  save: () => Promise<boolean>;
  invalidSetIds: readonly string[];
  touchedFields: readonly string[];
}) {
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [noteSetId, setNoteSetId] = useState<string | null>(null);
  async function handleSave() {
    setSaveState("saving");
    const saved = await save();
    setSaveState(saved ? "saved" : "error");
    if (saved) window.setTimeout(() => setSaveState("idle"), 2400);
  }
  return (
    <section className="set-log">
      <div className="set-grid labels">
        <span>SET</span>
        <span>KG</span>
        <span>REPS</span>
        <span>NOTE</span>
        <span />
      </div>
      {active.sets.map((s, i) => {
        const setWasInvalid = invalidSetIds.includes(s.id);
        const weightInvalid =
          !isValidWeight(s.weight) &&
          (setWasInvalid || touchedFields.includes(`${s.id}:weight`));
        const repsInvalid =
          !isValidReps(s.reps) &&
          (setWasInvalid || touchedFields.includes(`${s.id}:reps`));
        const noteOpen = noteSetId === s.id;
        return (
          <div className="set-entry" key={s.id}>
            <div
              className={`set-grid ${s.complete ? "done" : ""} ${weightInvalid || repsInvalid ? "invalid-set" : ""}`}
            >
              <button className="set-number" onClick={() => toggle(s.id)}>
                {s.complete ? "✓" : i + 1}
              </button>
              <input
                className={weightInvalid ? "invalid-input" : ""}
                inputMode="decimal"
                value={s.weight}
                onChange={(e) => {
                  touch(s.id, "weight");
                  update(s.id, { weight: cleanWeight(e.target.value) });
                }}
                placeholder="0"
                aria-label="Weight in kilograms"
              />
              <input
                className={repsInvalid ? "invalid-input" : ""}
                inputMode="numeric"
                value={s.reps}
                onChange={(e) => {
                  touch(s.id, "reps");
                  update(s.id, { reps: cleanReps(e.target.value) });
                }}
                placeholder="0"
                aria-label="Repetitions"
              />
              <button
                className={`note-button ${s.note ? "has-note" : ""}`}
                onClick={() => setNoteSetId(noteOpen ? null : s.id)}
                aria-label={`${s.note ? "Edit" : "Add"} note to set ${i + 1}`}
                aria-expanded={noteOpen}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25ZM18.63 8.12l1.25-1.25a1.5 1.5 0 0 0 0-2.12l-.63-.63a1.5 1.5 0 0 0-2.12 0l-1.25 1.25 2.75 2.75Z" />
                </svg>
              </button>
              <button
                className="delete-set"
                onClick={() => remove(s.id)}
                aria-label={`Remove set ${i + 1}`}
              >
                ×
              </button>
            </div>
            {noteOpen && (
              <label className="set-note-editor">
                <span>Set {i + 1} note</span>
                <input
                  autoFocus
                  value={s.note}
                  maxLength={500}
                  onChange={(e) => update(s.id, { note: e.target.value })}
                  placeholder="e.g. controlled tempo, assisted"
                />
                <button type="button" onClick={() => setNoteSetId(null)}>
                  Done
                </button>
              </label>
            )}
          </div>
        );
      })}
      <button className="add-set" onClick={add}>
        + Add set
      </button>
      <div className="set-footer">
        <span>Volume updates as you log</span>
        <strong>
          {active.sets
            .reduce(
              (sum, s) => sum + (Number(s.weight) || 0) * (Number(s.reps) || 0),
              0,
            )
            .toLocaleString()}{" "}
          kg
        </strong>
      </div>
      <button
        className={`save-exercise-draft ${saveState}`}
        onClick={() => void handleSave()}
        disabled={saveState === "saving"}
        aria-live="polite"
      >
        {saveState === "saving" ? (
          <>
            <span className="save-spinner" aria-hidden="true" />
            Saving progress…
          </>
        ) : saveState === "saved" ? (
          <>
            <span className="save-check" aria-hidden="true">
              ✓
            </span>
            Progress saved
          </>
        ) : saveState === "error" ? (
          "Try saving again"
        ) : (
          `Save ${active.name} progress`
        )}
      </button>
      <p className={`draft-save-feedback ${saveState}`} aria-live="polite">
        {saveState === "saved"
          ? "Saved securely to FitCrew."
          : saveState === "error"
            ? "Could not save. Your edits remain on this screen."
            : null}
      </p>
    </section>
  );
}
function GlobalWorkoutHistory({ sessions }: { sessions: readonly SessionRow[] }) {
  const newestDay = sessions[0]?.sessionDate ?? localDateKey(new Date());
  const [selectedDay, setSelectedDay] = useState(newestDay);
  const [visibleMonth, setVisibleMonth] = useState(monthKey(newestDay));
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sessionDays = useMemo(
    () => new Set(sessions.map((session) => session.sessionDate)),
    [sessions],
  );
  const daySessions = sessions.filter(
    (session) => session.sessionDate === selectedDay,
  );
  const dayClients = Array.from(
    daySessions.reduce<Map<string, { id: string; name: string; count: number }>>(
      (clients, session) => {
        const clientKey = sessionClientKey(session);
        const client = clients.get(clientKey);
        clients.set(clientKey, {
          id: clientKey,
          name: session.clientName,
          count: (client?.count ?? 0) + 1,
        });
        return clients;
      },
      new Map(),
    ).values(),
  );
  const activeClientId = selectedClientId ?? dayClients[0]?.id ?? null;
  const clientSessions = daySessions.filter(
    (session) => sessionClientKey(session) === activeClientId,
  );
  const calendarDate = new Date(`${visibleMonth}-01T00:00:00`);
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth() + 1;
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
  const selectDay = (day: string) => {
    setSelectedDay(day);
    setSelectedClientId(null);
    setExpandedId(null);
  };
  const changeMonth = (offset: number) => {
    const date = new Date(year, month - 1 + offset, 1);
    setVisibleMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <section id="global-workout-history" className="global-workout-history" aria-label="Workout history">
      <header>
        <div>
          <p>WORKOUT HISTORY</p>
          <h2>Find a client’s training day</h2>
        </div>
        <span>{sessions.length} completed workouts</span>
      </header>
      <div className="history-flow-labels" aria-hidden="true">
        <span>1. Select day</span><span>2. Select client</span><span>3. Review workout</span>
      </div>
      <div className="history-calendar-layout">
        <section className="workout-calendar" aria-label="Select workout date">
          <div className="calendar-heading">
            <button aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button>
            <strong>{monthLabel}</strong>
            <button aria-label="Next month" onClick={() => changeMonth(1)}>›</button>
          </div>
          <div className="calendar-weekdays" aria-hidden="true">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="calendar-days">
            {Array.from({ length: firstDay + daysInMonth }, (_, index) => {
              if (index < firstDay) return <span key={`blank-${index}`} />;
              const dayNumber = index - firstDay + 1;
              const day = `${visibleMonth}-${String(dayNumber).padStart(2, "0")}`;
              const hasWorkout = sessionDays.has(day);
              const selected = selectedDay === day;
              return <button key={day} className={`${hasWorkout ? "has-workout" : ""} ${selected ? "selected" : ""}`} onClick={() => selectDay(day)} aria-pressed={selected}><span>{dayNumber}</span>{hasWorkout && <i aria-label="Workout logged" />}</button>;
            })}
          </div>
          <p><i aria-hidden="true" /> Workout logged</p>
        </section>
        <section className="history-day-results" aria-live="polite">
          <div className="history-selected-day">
            <span>SELECTED DAY</span>
            <strong>{formatHistoryDay(selectedDay)}</strong>
            <small>{daySessions.length ? `${daySessions.length} workout${daySessions.length === 1 ? "" : "s"} logged` : "No workouts logged"}</small>
          </div>
          {dayClients.length ? <>
            <div className="history-client-list" aria-label="Clients with workouts">
              {dayClients.map((client) => <button key={client.id} className={activeClientId === client.id ? "selected" : ""} onClick={() => { setSelectedClientId(client.id); setExpandedId(null); }} aria-pressed={activeClientId === client.id}><span className="client-avatar">{client.name.slice(0, 1)}</span><span><strong>{client.name}</strong><small>{client.count} workout{client.count === 1 ? "" : "s"}</small></span><b>›</b></button>)}
            </div>
            <div className="history-client-workouts">
              <p>WORKOUTS FOR {dayClients.find((client) => client.id === activeClientId)?.name?.toUpperCase()}</p>
              {clientSessions.map((session) => {
                const expanded = expandedId === session.id;
                const hasNotes = Boolean(session.notes && session.notes !== "Logged from workout board");
                return <article key={session.id} className={expanded ? "expanded" : ""}>
                  <button className="history-session-trigger" onClick={() => setExpandedId(expanded ? null : session.id)} aria-expanded={expanded}><span><strong>{session.startTime}{session.endTime ? ` – ${session.endTime}` : ""}</strong><small>{session.exerciseCount} exercises</small></span><b>{expanded ? "Hide" : "View"} <i>›</i></b></button>
                  {expanded && <div className="global-history-detail"><div className="history-exercises">{session.exercises.map((exercise, index) => <div key={`${exercise.name}-${index}`}><strong>{exercise.name}</strong><span>{exercise.reps || `${exercise.sets ?? "—"} sets`}</span></div>)}</div>{hasNotes && <p className="history-note">{session.notes}</p>}</div>}
                </article>;
              })}
            </div>
          </> : <div className="history-day-empty"><span>○</span><strong>No training logged</strong><p>Choose a highlighted day to see the clients and workouts completed that day.</p></div>}
        </section>
      </div>
    </section>
  );
}

function HistoryView({ sessions }: { sessions: readonly SessionRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <section className="history-view">
      <h2>Previous workouts</h2>
      {sessions.length ? (
        sessions.slice(0, 6).map((s) => {
          const expanded = expandedId === s.id;
          const hasNotes = Boolean(
            s.notes && s.notes !== "Logged from workout board",
          );
          return (
            <article className={expanded ? "expanded" : ""} key={s.id}>
              <time>{formatDate(s.sessionDate)}</time>
              <div>
                <strong>{s.exerciseCount} exercises</strong>
                <span>
                  {s.startTime}
                  {s.endTime ? ` – ${s.endTime}` : ""}
                </span>
                {expanded && (
                  <div className="history-exercises">
                    {s.exercises.map((exercise, index) => (
                      <div key={`${exercise.name}-${index}`}>
                        <strong>{exercise.name}</strong>
                        <span>
                          {exercise.reps || `${exercise.sets ?? "—"} sets`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {expanded &&
                  (hasNotes ? (
                    <p className="history-note">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25ZM18.63 8.12l1.25-1.25a1.5 1.5 0 0 0 0-2.12l-.63-.63a1.5 1.5 0 0 0-2.12 0l-1.25 1.25 2.75 2.75Z" />
                      </svg>
                      {s.notes}
                    </p>
                  ) : (
                    <p className="history-empty-note">
                      No notes were saved for this workout.
                    </p>
                  ))}
              </div>
              <button
                onClick={() => setExpandedId(expanded ? null : s.id)}
                aria-expanded={expanded}
              >
                {expanded ? "Hide" : "View"} <span aria-hidden="true">›</span>
              </button>
            </article>
          );
        })
      ) : (
        <p>No earlier sets logged for this exercise.</p>
      )}
    </section>
  );
}
function GraphView({
  sessions,
  exercise,
}: {
  sessions: readonly SessionRow[];
  exercise: string;
}) {
  const values = sessions
    .slice(0, 7)
    .reverse()
    .map((s) => s.exerciseCount);
  const maximum = Math.max(...values, 1);
  const points = values.map((value) => 66 - (value / maximum) * 46);
  const path = points
    .map(
      (y, i) =>
        `${i ? "L" : "M"} ${12 + i * (210 / Math.max(points.length - 1, 1))} ${y}`,
    )
    .join(" ");
  return (
    <section className="graph-view">
      <div className="graph-heading">
        <div>
          <h2>Workout activity</h2>
          <p>{exercise} · exercises logged per session</p>
        </div>
        <select aria-label="Graph metric">
          <option>Session activity</option>
        </select>
      </div>
      <svg viewBox="0 0 240 82" role="img" aria-label="Recent workout activity">
        <path className="gridline" d="M8 16H235M8 41H235M8 66H235" />
        <path className="trend" d={path} />
        {points.map((y, i) => (
          <circle
            key={i}
            cx={12 + i * (210 / Math.max(points.length - 1, 1))}
            cy={y}
            r="3"
          />
        ))}
      </svg>
      <div className="graph-summary">
        <strong>
          {sessions.length
            ? `${Math.max(...values)} exercises in the busiest session`
            : "No session data yet"}
        </strong>
        <span>
          Session activity becomes more useful as the client’s training history
          grows.
        </span>
      </div>
    </section>
  );
}
function Picker({
  tenantId,
  query,
  setQuery,
  exercises,
  add,
  addCustom,
  close,
}: {
  tenantId: string;
  query: string;
  setQuery: (v: string) => void;
  exercises: readonly {
    id: string;
    name: string;
    muscleGroup: string | null;
    tenantId: string | null;
  }[];
  add: (name: string) => void;
  addCustom: (exercise: {
    id: string;
    name: string;
    muscleGroup: string;
    tenantId: string;
  }) => void;
  close: () => void;
}) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [muscleGroup, setMuscleGroup] = useState("Full Body");
  const [createState, setCreateState] = useState<"idle" | "saving" | "error">("idle");
  const groups = exercises.reduce<Record<string, (typeof exercises)[number][]>>(
    (all, exercise) => {
      const category = exercise.muscleGroup ?? "Custom";
      (all[category] ??= []).push(exercise);
      return all;
    },
    {},
  );
  const isSearching = query.trim().length > 0;
  const requestedName = query.trim().replace(/\s+/g, " ");
  const canCreate = requestedName.length >= 2 && !exercises.some((exercise) => exercise.name.toLowerCase() === requestedName.toLowerCase());
  async function createExercise() {
    if (!canCreate) return;
    setCreateState("saving");
    try {
      const response = await fetch("/api/training/exercise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId, name: requestedName, muscleGroup }),
      });
      if (!response.ok) throw new Error("Could not create exercise");
      const result = (await response.json()) as { exerciseId: string };
      addCustom({ id: result.exerciseId, name: requestedName, muscleGroup, tenantId });
    } catch {
      setCreateState("error");
    }
  }
  return (
    <div className="picker-backdrop" onMouseDown={close}>
      <section
        className="exercise-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Add exercise"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2>Add exercise</h2>
            <p>
              {isSearching ? "Matching exercises" : "Choose a muscle group"}
            </p>
          </div>
          <button onClick={close}>×</button>
        </header>
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenCategory(null);
          }}
          placeholder="Search exercises e.g. dum press"
        />
        <div className="exercise-results">
          {canCreate && (
            <section className="create-custom-exercise">
              <div>
                <span>NO MATCH FOUND</span>
                <strong>Create “{requestedName}” as a shared exercise</strong>
                <p>Every coach in your organization will be able to use it.</p>
              </div>
              <label>
                <span>Exercise category</span>
                <select value={muscleGroup} onChange={(event) => setMuscleGroup(event.target.value)}>
                  {["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Core", "Cardio", "Full Body", "Mobility", "Other"].map((group) => <option key={group}>{group}</option>)}
                </select>
              </label>
              <button className="create-exercise-button" onClick={() => void createExercise()} disabled={createState === "saving"}>
                {createState === "saving" ? <><span className="save-spinner" aria-hidden="true" /> Creating shared exercise…</> : <>
                  <span><strong>Create & add exercise</strong><small>Save to shared library</small></span>
                  <b aria-hidden="true">›</b>
                </>}
              </button>
              {createState === "error" && <p className="create-exercise-error">Could not create this exercise. Please try again.</p>}
            </section>
          )}
          {Object.entries(groups).map(([category, items]) => {
            const expanded = isSearching || openCategory === category;
            return (
              <section
                className={`exercise-category ${expanded ? "expanded" : ""}`}
                key={category}
              >
                <button
                  className="category-trigger"
                  onClick={() =>
                    setOpenCategory((current) =>
                      current === category ? null : category,
                    )
                  }
                  aria-expanded={expanded}
                >
                  <span>{category}</span>
                  <small>{items.length} exercises</small>
                  <b>⌄</b>
                </button>
                {expanded && (
                  <div className="category-items">
                    {items.map((e) => (
                      <button key={e.id} onClick={() => add(e.name)}>
                        <span>{e.name}</span>
                        <small>{e.tenantId ? "Custom" : "Standard"}</small>
                        <b>+</b>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {exercises.length === 0 && !canCreate && (
            <p className="picker-empty">
              Start typing an exercise name to create a custom exercise.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
function formatHistoryDay(value: string) {
  const today = localDateKey(new Date());
  const yesterday = localDateKey(new Date(Date.now() - 86_400_000));
  if (value === today) return "Today";
  if (value === yesterday) return "Yesterday";
  return formatDate(value);
}
function monthKey(value: string) {
  return value.slice(0, 7);
}
function localDateKey(value: Date) {
  const offsetDate = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}
function formatRestDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
function sessionClientKey(session: SessionRow) {
  // Earlier stored sessions did not include clientId in the serialized dashboard.
  // Fall back to the immutable display name so their history remains accessible.
  return session.clientId || session.clientName;
}
