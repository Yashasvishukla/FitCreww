'use client';
import { useMemo, useState } from 'react';
import type { NutritionDaySummary } from '@fitcrew/db';

type Props = { tenantId: string; clientId: string; initial: NutritionDaySummary };
type Message = { text: string; kind: 'success' | 'error' } | null;

export function NutritionPanel({ tenantId, clientId, initial }: Props) {
  const [summary, setSummary] = useState(initial);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState(false);
  const meals = useMemo(() => ['breakfast', 'lunch', 'dinner', 'snack'] as const, []);

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

  return <div className="nutrition-panel"><div className="nutrition-summary"><div><span>Today</span><strong>{summary.totals.calories}</strong><small>kcal</small></div><div><span>Protein</span><strong>{summary.totals.proteinGrams}g</strong></div><div><span>Carbs</span><strong>{summary.totals.carbGrams}g</strong></div><div><span>Fat</span><strong>{summary.totals.fatGrams}g</strong></div></div><div className="nutrition-meals">{meals.map((meal) => <div key={meal}><span>{meal}</span><strong>{summary.byMeal[meal]?.calories ?? 0}</strong><small>{summary.byMeal[meal]?.count ?? 0} items</small></div>)}</div><form className="auth-form nutrition-form" onSubmit={submit}><div className="form-grid"><label><span>Food item</span><input name="foodName" placeholder="150g rice, 2 eggs, paneer" maxLength={200} required /></label><label><span>Meal</span><select name="mealType" defaultValue="lunch"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></label><label><span>Serving text</span><input name="quantityText" placeholder="150g, 1 bowl, 2 pieces" maxLength={120} /></label><label><span>Serving grams</span><input name="servingGrams" type="number" min="1" max="10000" step="1" /></label></div><details><summary>Manual nutrition override</summary><div className="form-grid"><label><span>Calories</span><input name="calories" type="number" min="0" max="20000" step="1" /></label><label><span>Protein (g)</span><input name="proteinGrams" type="number" min="0" step="0.1" /></label><label><span>Carbs (g)</span><input name="carbGrams" type="number" min="0" step="0.1" /></label><label><span>Fat (g)</span><input name="fatGrams" type="number" min="0" step="0.1" /></label></div></details><label><span>Notes</span><input name="notes" maxLength={1000} placeholder="Home cooked, restaurant, label checked" /></label><button className="primary-button" type="submit" disabled={pending}>{pending ? 'Logging...' : 'Log food'}</button>{message ? <p role="status" className={message.kind === 'success' ? 'success-message' : 'form-error'}>{message.text}</p> : null}</form><div className="data-list nutrition-log">{summary.entries.map((entry) => <article className="data-row" key={entry.id}><div><h3>{entry.foodName} · {entry.calories} kcal</h3><p className="muted">{entry.mealType} · {entry.servingGrams}g · P {entry.proteinGrams}g / C {entry.carbGrams}g / F {entry.fatGrams}g · {sourceLabel(entry.source)}{entry.sourceId ? ` #${entry.sourceId}` : ''} · {Math.round(entry.confidence * 100)}% confidence</p></div></article>)}</div></div>;
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sourceLabel(source: string): string {
  if (source === 'usda-fdc') return 'USDA FoodData Central';
  if (source === 'manual') return 'Manual';
  return 'FitCrew fallback';
}
