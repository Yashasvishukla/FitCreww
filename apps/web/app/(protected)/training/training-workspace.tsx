'use client';

import { useMemo, useState } from 'react';
import type { TrainingDashboard } from '@fitcrew/db';

type Props = { tenantId: string; dashboard: TrainingDashboard };
type ExerciseLine = { name: string; sets?: string; reps?: string };
type SessionRow = TrainingDashboard['sessions'][number];

export function TrainingWorkspace({ tenantId, dashboard }: Props) {
  const [clientId, setClientId] = useState(dashboard.clients[0]?.clientId ?? '');
  const [workspace, setWorkspace] = useState<TrainingDashboard>(dashboard);
  const [sessions, setSessions] = useState<readonly SessionRow[]>(dashboard.sessions);
  const [status, setStatus] = useState('');
  const activeClient = workspace.clients.find((client) => client.clientId === clientId);
  const currentPlanDays = workspace.currentPlan?.days ?? [];
  const exerciseNames = useMemo(() => workspace.exercises.map((exercise) => exercise.name), [workspace.exercises]);
  const latestSession = sessions[0];
  const planCompletion = currentPlanDays.filter((day) => day.exercises.length > 0).length;

  async function switchClient(nextClientId: string) { setClientId(nextClientId); const response = await fetch(`/api/training/dashboard?tenantId=${tenantId}&clientId=${nextClientId}`); if (response.ok) { const next = await response.json() as TrainingDashboard; setWorkspace(next); setSessions(next.sessions); } }

  async function logSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const exercises = parseExerciseLines(String(data.get('exercises') ?? ''));
    const payload = {
      tenantId,
      clientId,
      sessionDate: data.get('sessionDate'),
      startTime: data.get('startTime'),
      endTime: data.get('endTime') || null,
      exercises,
      notes: data.get('notes'),
    };
    const optimistic: SessionRow = {
      id: `pending-${Date.now()}`,
      clientName: activeClient?.name ?? 'Client',
      sessionDate: String(payload.sessionDate),
      startTime: String(payload.startTime),
      endTime: payload.endTime ? String(payload.endTime) : null,
      exerciseCount: exercises.length,
      notes: String(payload.notes ?? '') || null,
    };
    setSessions((current) => [optimistic, ...current].slice(0, 12));
    setStatus('Saving session...');
    const response = await fetch('/api/training/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json() as { error?: string };
    setStatus(response.ok ? 'Session logged.' : (result.error ?? 'Session log failed.'));
    if (response.ok) form.reset();
    if (!response.ok) setSessions((current) => current.filter((row) => row.id !== optimistic.id));
  }

  async function savePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const days = Array.from({ length: 7 }, (_, index) => {
      const dayNumber = index + 1;
      return { dayNumber, exercises: parseExerciseLines(String(data.get(`day-${dayNumber}`) ?? '')), notes: String(data.get(`notes-${dayNumber}`) ?? '') };
    });
    const response = await fetch('/api/training/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, days }) });
    const result = await response.json() as { version?: number; error?: string };
    setStatus(response.ok ? `Plan v${result.version} saved.` : (result.error ?? 'Plan save failed.'));
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/training/evaluation-schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, clientId, cadence: data.get('cadence'), nextDueDate: data.get('nextDueDate') }) });
    const result = await response.json() as { error?: string };
    setStatus(response.ok ? 'Evaluation schedule saved.' : (result.error ?? 'Schedule save failed.'));
  }

  async function addExercise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/training/exercise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, name: data.get('name'), muscleGroup: data.get('muscleGroup') }) });
    const result = await response.json() as { error?: string };
    setStatus(response.ok ? 'Exercise added.' : (result.error ?? 'Exercise save failed.'));
    if (response.ok) event.currentTarget.reset();
  }

  return (
    <div className="training-shell">
      <section className="training-command">
        <div>
          <p className="eyebrow">Active client</p>
          <label className="client-switcher">
            <span className="sr-only">Client</span>
            <select value={clientId} onChange={(event) => void switchClient(event.target.value)} required>
              {workspace.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.name}</option>)}
            </select>
          </label>
        </div>
        <div className="training-stats" aria-label="Training status">
          <Metric label="Last session" value={latestSession ? formatShortDate(latestSession.sessionDate) : 'None'} />
          <Metric label="Plan days" value={`${planCompletion}/7`} />
          <Metric label="Due" value={String(workspace.dueEvaluations.length)} />
        </div>
      </section>

      {status ? <p className={status.includes('failed') || status === 'Forbidden.' ? 'training-toast error' : 'training-toast'} role="status">{status}</p> : null}

      <div className="training-grid">
        <section className="surface training-log">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Stopwatch path</p>
              <h2>Log session</h2>
            </div>
            <span className="count-label">Under 60 sec</span>
          </div>
          <form className="training-form" onSubmit={logSession}>
            <div className="form-grid compact">
              <Field label="Date"><input name="sessionDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
              <Field label="Start"><input name="startTime" type="time" required /></Field>
              <Field label="End"><input name="endTime" type="time" /></Field>
            </div>
            <Field label="Exercises">
              <textarea name="exercises" rows={5} required placeholder={exerciseNames.slice(0, 3).join(', ') || 'Squat 3x10, Push-up 3x12'} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={3} placeholder="Optional coach notes" />
            </Field>
            <button className="primary-button training-submit" type="submit" disabled={!clientId}>Log session</button>
          </form>
        </section>

        <aside className="training-side">
          <section className="surface">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recent</p>
                <h2>Sessions</h2>
              </div>
              <span className="count-label">{sessions.length}</span>
            </div>
            <div className="timeline-list">
              {sessions.length === 0 ? <p className="empty-state">No sessions logged yet.</p> : sessions.map((session) => (
                <article className="timeline-row" key={session.id}>
                  <time>{formatShortDate(session.sessionDate)}</time>
                  <div>
                    <h3>{session.clientName}</h3>
                    <p>{session.startTime}{session.endTime ? `-${session.endTime}` : ''} · {session.exerciseCount} exercises</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="surface">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Evaluations</p>
                <h2>Due list</h2>
              </div>
              <span className="count-label">{workspace.dueEvaluations.length}</span>
            </div>
            <form className="inline-form polished-form" onSubmit={saveSchedule}>
              <div className="form-grid compact">
                <Field label="Cadence">
                  <select name="cadence" defaultValue="monthly">
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </Field>
                <Field label="Next due"><input name="nextDueDate" type="date" required /></Field>
              </div>
              <button className="secondary-button" type="submit" disabled={!clientId}>Set schedule</button>
            </form>
            <div className="due-stack">
              {workspace.dueEvaluations.length === 0 ? <p className="empty-state">No evaluations due.</p> : workspace.dueEvaluations.map((due) => (
                <article className="due-row" key={due.id}>
                  <div>
                    <h3>{due.clientName}</h3>
                    <p>{formatShortDate(due.nextDueDate)} · {due.cadence}</p>
                  </div>
                  <a className="secondary-button compact-action" href={`/clients/${due.clientId}?tenantId=${tenantId}`}>Record</a>
                </article>
              ))}
            </div>
          </section>
        </aside>

        <section className="surface plan-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Workout plan</p>
              <h2>{workspace.currentPlan ? `Current plan v${workspace.currentPlan.version}` : 'New 7-day plan'}</h2>
            </div>
            <span className="count-label">Versioned history</span>
          </div>
          <form className="plan-form" onSubmit={savePlan}>
            {Array.from({ length: 7 }, (_, index) => {
              const dayNumber = index + 1;
              const existing = workspace.currentPlan?.days.find((day) => day.dayNumber === dayNumber);
              return (
                <fieldset key={dayNumber}>
                  <legend>Day {dayNumber}</legend>
                  <textarea name={`day-${dayNumber}`} rows={3} required defaultValue={existing?.exercises.map(formatExercise).join(', ') ?? ''} placeholder="Strength 3x8, Mobility 2x10" />
                  <input name={`notes-${dayNumber}`} placeholder="Notes" defaultValue={existing?.notes ?? ''} />
                </fieldset>
              );
            })}
            <button className="primary-button" type="submit" disabled={!clientId}>Save new version</button>
          </form>
          {workspace.planHistory.length > 1 ? <div className="plan-history" aria-label="Plan history"><p className="eyebrow">History</p>{workspace.planHistory.map((plan) => <span key={plan.id}>v{plan.version}</span>)}</div> : null}
        </section>

        <section className="surface catalog-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Catalog</p>
              <h2>Exercise library</h2>
            </div>
            <span className="count-label">{workspace.exercises.length} items</span>
          </div>
          <form className="catalog-form" onSubmit={addExercise}>
            <Field label="Exercise"><input name="name" placeholder="Cable row" required /></Field>
            <Field label="Muscle group"><input name="muscleGroup" placeholder="Back" /></Field>
            <button className="secondary-button" type="submit">Add exercise</button>
          </form>
          <div className="exercise-pills" aria-label="Exercise catalog">
            {workspace.exercises.slice(0, 18).map((exercise) => (
              <span key={exercise.id}>{exercise.name}</span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

function parseExerciseLines(value: string): ExerciseLine[] {
  return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = item.match(/^(.*?)\s+(\d+\s*x\s*[\w-]+)$/i);
    return match?.[1] && match[2] ? { name: match[1].trim(), reps: match[2].replace(/\s+/g, '') } : { name: item };
  });
}

function formatExercise(exercise: ExerciseLine): string {
  return [exercise.name, exercise.sets, exercise.reps].filter(Boolean).join(' ');
}

function formatShortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}
