'use client';
import { useEffect, useMemo, useState } from 'react';
import type { NutritionCalendarDay, NutritionDaySummary } from '@fitcrew/db';

type Props = { tenantId: string; clientId: string; initial: NutritionDaySummary; loadError?: boolean };
type Message = { text: string; kind: 'success' | 'error' } | null;

export function NutritionPanel({ tenantId, clientId, initial, loadError = false }: Props) {
  const [summary, setSummary] = useState(initial);
  const [history, setHistory] = useState<NutritionCalendarDay[]>([]);
  const [historyPending, setHistoryPending] = useState(true);
  const [historyView, setHistoryView] = useState<'week' | 'calendar'>('week');
  const [calendarMonth, setCalendarMonth] = useState(initial.date.slice(0, 7));
  const [calendarDays, setCalendarDays] = useState<NutritionCalendarDay[]>([]);
  const [calendarPending, setCalendarPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const meals = useMemo(() => ['breakfast', 'lunch', 'dinner', 'snack'] as const, []);

  // History is a stable recent-week reference, not a moving window around an old day.
  const dates = useMemo(() => recentDates(todayString()), []);

  // Next.js preserves this client component across search-param navigation.
  // Reset all client-scoped state before loading the newly selected client's data.
  useEffect(() => {
    setSummary(initial);
    setHistory([]);
    setCalendarDays([]);
    setCalendarMonth(initial.date.slice(0, 7));
    setMessage(null);
  }, [clientId, initial]);

  async function loadDay(date: string) {
    setPending(true);
    setMessage(null);
    const response = await fetch(`/api/clients/nutrition?tenantId=${tenantId}&clientId=${clientId}&date=${date}`);
    const next = await response.json() as NutritionDaySummary | { error?: string };
    if (response.ok && 'entries' in next) setSummary(next);
    else setMessage({ text: 'Could not load that day.', kind: 'error' });
    setPending(false);
  }

  useEffect(() => {
    let active = true;
    setHistoryPending(true);
    fetch(`/api/clients/nutrition?tenantId=${tenantId}&clientId=${clientId}&from=${dates[dates.length - 1]}&to=${dates[0]}`)
      .then(async (response) => response.ok ? await response.json() as NutritionCalendarDay[] : [])
      .then((days) => { if (active) { setHistory(days); setHistoryPending(false); } })
      .catch(() => { if (active) { setHistory([]); setHistoryPending(false); } });
    return () => { active = false; };
  }, [clientId, dates, tenantId]);

  useEffect(() => {
    if (historyView !== 'calendar') return;
    let active = true;
    setCalendarPending(true);
    fetch(`/api/clients/nutrition?tenantId=${tenantId}&clientId=${clientId}&month=${calendarMonth}`)
      .then(async (response) => response.ok ? await response.json() as NutritionCalendarDay[] : [])
      .then((days) => { if (active) { setCalendarDays(days); setCalendarPending(false); } })
      .catch(() => { if (active) { setCalendarDays([]); setCalendarPending(false); } });
    return () => { active = false; };
  }, [calendarMonth, clientId, historyView, tenantId]);

  useEffect(() => {
    setCalendarMonth(summary.date.slice(0, 7));
  }, [summary.date]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const calories = optionalNumber(data.get('calories'));
    const nutrition = calories === undefined ? undefined : {
      calories,
      proteinGrams: optionalNumber(data.get('proteinGrams')),
      carbGrams: optionalNumber(data.get('carbGrams')),
      fatGrams: optionalNumber(data.get('fatGrams')),
    };
    const response = await fetch('/api/clients/nutrition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        clientId,
        foodName: data.get('foodName'),
        mealType: data.get('mealType'),
        inputSource: nutrition ? 'manual' : 'text',
        quantityText: data.get('quantityText'),
        servingGrams: optionalNumber(data.get('servingGrams')),
        nutrition,
        notes: data.get('notes'),
      }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setPending(false);
      setMessage({ text: result.error ?? 'Could not log food.', kind: 'error' });
      return;
    }
    const refresh = await fetch(`/api/clients/nutrition?tenantId=${tenantId}&clientId=${clientId}&date=${summary.date}`);
    const next = await refresh.json() as NutritionDaySummary | { error?: string };
    if (refresh.ok && 'entries' in next) setSummary(next);
    form.reset();
    setPending(false);
    setMessage({ text: 'Food logged.', kind: 'success' });
  }

  const isToday = summary.date === todayString();
  return <div className="nutrition-panel">
    {loadError ? <p className="nutrition-load-note" role="status">The journal opened, but existing entries could not be loaded yet. You can still start a new daily log.</p> : null}
    <section className="nutrition-day-card">
      <div className="nutrition-day-toolbar"><button className="date-step" type="button" aria-label="Previous day" onClick={() => loadDay(shiftDate(summary.date, -1))}>‹</button><div><p className="eyebrow">{isToday ? 'Today’s intake' : 'Daily intake'}</p><h3>{formatDate(summary.date)}</h3></div>{!isToday ? <button className="nutrition-today-button" type="button" onClick={() => loadDay(todayString())}>Today</button> : null}<label className="nutrition-date-picker"><span className="sr-only">Choose date</span><input aria-label="Choose date" type="date" value={summary.date} max={todayString()} onChange={(event) => loadDay(event.target.value)} /></label><button className="date-step" type="button" aria-label="Next day" disabled={isToday || pending} onClick={() => loadDay(shiftDate(summary.date, 1))}>›</button></div>
      <div className="nutrition-summary"><div className="nutrition-calorie-total"><span>Total calories</span><strong>{summary.totals.calories}</strong><small>kcal logged</small></div><div><span>Protein</span><strong>{summary.totals.proteinGrams}g</strong><small>daily total</small></div><div><span>Carbs</span><strong>{summary.totals.carbGrams}g</strong><small>daily total</small></div><div><span>Fat</span><strong>{summary.totals.fatGrams}g</strong><small>daily total</small></div></div>
    </section>
    <section className="nutrition-section"><div className="nutrition-section-heading"><div><p className="eyebrow">Quick add</p><h3>Log a meal</h3></div><span className="nutrition-item-count">{summary.entries.length} {summary.entries.length === 1 ? 'item' : 'items'} today</span></div><form className="auth-form nutrition-form" onSubmit={submit}><div className="form-grid"><label><span>Food item</span><input name="foodName" placeholder="e.g. 2 eggs and toast" maxLength={200} required /></label><label><span>Meal</span><select name="mealType" defaultValue="lunch"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></label><label><span>Portion</span><input name="quantityText" placeholder="1 bowl, 150g, 2 pieces" maxLength={120} /></label><label><span>Weight (g)</span><input name="servingGrams" type="number" min="1" max="10000" step="1" /></label></div><details><summary>Add exact macros</summary><div className="form-grid"><label><span>Calories</span><input name="calories" type="number" min="0" max="20000" step="1" /></label><label><span>Protein (g)</span><input name="proteinGrams" type="number" min="0" step="0.1" /></label><label><span>Carbs (g)</span><input name="carbGrams" type="number" min="0" step="0.1" /></label><label><span>Fat (g)</span><input name="fatGrams" type="number" min="0" step="0.1" /></label></div></details><label><span>Note <em>optional</em></span><input name="notes" maxLength={1000} placeholder="Home cooked, restaurant, label checked" /></label><div className="nutrition-form-action"><button className="primary-button" type="submit" disabled={pending}>{pending ? 'Logging...' : 'Add to log'}</button>{message ? <p role="status" className={message.kind === 'success' ? 'success-message' : 'form-error'}>{message.text}</p> : null}</div></form></section>
    <section className="nutrition-section"><div className="nutrition-section-heading"><div><p className="eyebrow">Meal breakdown</p><h3>Today’s log</h3></div></div><div className="nutrition-meals">{meals.map((meal) => <div key={meal}><span>{meal}</span><strong>{summary.byMeal[meal]?.calories ?? 0}</strong><small>{summary.byMeal[meal]?.count ?? 0} {summary.byMeal[meal]?.count === 1 ? 'item' : 'items'}</small></div>)}</div><div className="data-list nutrition-log">{summary.entries.length ? summary.entries.map((entry) => <article className="data-row nutrition-entry" key={entry.id}><div><h3>{entry.foodName}</h3><p className="muted">{entry.mealType} · {entry.servingGrams}g · P {entry.proteinGrams}g / C {entry.carbGrams}g / F {entry.fatGrams}g</p></div><strong>{entry.calories}<small> kcal</small></strong></article>) : <p className="nutrition-empty">Nothing logged yet. Add the first meal above.</p>}</div></section>
    <section className="nutrition-section nutrition-history"><div className="nutrition-section-heading"><div><p className="eyebrow">History</p><h3>Calorie history</h3></div><div className="nutrition-history-actions">{!isToday ? <button className="nutrition-today-button" type="button" onClick={() => loadDay(todayString())}>Today</button> : null}<div className="nutrition-view-toggle" role="group" aria-label="History view"><button className={historyView === 'week' ? 'is-active' : ''} type="button" onClick={() => setHistoryView('week')}>7 days</button><button className={historyView === 'calendar' ? 'is-active' : ''} type="button" onClick={() => setHistoryView('calendar')}>Calendar</button></div></div></div>{historyView === 'week' ? <><p className="nutrition-history-hint">{historyPending ? 'Updating…' : 'Tap a day to review'}</p><div className="nutrition-history-list">{dates.map((date) => { const day = history.find((item) => item.date === date) ?? { date, calories: 0, count: 0 }; return <button className={`nutrition-history-day${day.date === summary.date ? ' is-selected' : ''}`} key={day.date} type="button" onClick={() => loadDay(day.date)}><span>{day.date === todayString() ? 'Today' : shortDate(day.date)}</span><strong>{day.calories}</strong><small>kcal · {day.count} {day.count === 1 ? 'item' : 'items'}</small></button>; })}</div></> : <NutritionCalendar month={calendarMonth} days={calendarDays} selectedDate={summary.date} pending={calendarPending} onMonthChange={setCalendarMonth} onSelect={loadDay} />}</section>
  </div>;
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function todayString() { return new Date().toISOString().slice(0, 10); }
function shiftDate(date: string, amount: number) { const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + amount); return next.toISOString().slice(0, 10); }
function recentDates(end: string) { return Array.from({ length: 7 }, (_, index) => shiftDate(end, -index)); }
function formatDate(date: string) { return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`)); }
function shortDate(date: string) { return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`)); }

function NutritionCalendar({ month, days, selectedDate, pending, onMonthChange, onSelect }: { month: string; days: NutritionCalendarDay[]; selectedDate: string; pending: boolean; onMonthChange: (month: string) => void; onSelect: (date: string) => void }) {
  const first = new Date(`${month}-01T12:00:00`);
  const firstOffset = (first.getDay() + 6) % 7;
  const monthDays = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const byDate = new Map(days.map((day) => [day.date, day]));
  return <div className="nutrition-calendar"><div className="nutrition-calendar-toolbar"><button className="date-step" type="button" aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}>‹</button><strong>{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(first)}</strong><button className="nutrition-today-button" type="button" onClick={() => onMonthChange(todayString().slice(0, 7))}>This month</button><button className="date-step" type="button" aria-label="Next month" disabled={month >= todayString().slice(0, 7)} onClick={() => onMonthChange(shiftMonth(month, 1))}>›</button></div><div className="nutrition-calendar-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div><div className="nutrition-calendar-grid">{Array.from({ length: firstOffset }, (_, index) => <span className="nutrition-calendar-blank" key={`blank-${index}`} />)}{Array.from({ length: monthDays }, (_, index) => { const day = index + 1; const date = `${month}-${String(day).padStart(2, '0')}`; const record = byDate.get(date); const isToday = date === todayString(); return <button className={`nutrition-calendar-day${date === selectedDate ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`} key={date} type="button" onClick={() => onSelect(date)}><span>{day}</span>{record ? <strong>{record.calories}<small> kcal</small></strong> : <small>—</small>}</button>; })}</div>{pending ? <p className="nutrition-history-hint">Updating calendar…</p> : <p className="nutrition-history-hint">Tap a day to review its food log.</p>}</div>;
}

function shiftMonth(month: string, amount: number) { const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth() + amount); return date.toISOString().slice(0, 7); }
