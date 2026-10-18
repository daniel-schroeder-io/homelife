import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  MealPlanDetail,
  MealPlanEntryView,
  MealPlanRecipeSummary,
} from '../../shared/types'
import { ApiError } from '../lib/api'
import {
  currentWeekStartLocal,
  entryTitle,
  fetchCurrentPlan,
  fetchSwapOptions,
  patchPlanEntry,
  todayIsoLocal,
} from '../lib/plans'
import { subscribePlanStream } from '../lib/planSync'

export function Tonight() {
  const weekStart = currentWeekStartLocal()
  const [plan, setPlan] = useState<MealPlanDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [swapOpen, setSwapOpen] = useState(false)
  const [swapOptions, setSwapOptions] = useState<MealPlanRecipeSummary[]>([])
  const [swapLoading, setSwapLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await fetchCurrentPlan(weekStart)
      setPlan(next)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load tonight',
      )
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  const quietRefresh = useCallback(async () => {
    try {
      const next = await fetchCurrentPlan(weekStart)
      setPlan(next)
    } catch {
      /* keep current view on background sync failure */
    }
  }, [weekStart])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const unsub = subscribePlanStream(weekStart, {
      onEvent: (event) => {
        if (event.type === 'plan') void quietRefresh()
      },
    })
    return unsub
  }, [weekStart, quietRefresh])

  const today = todayIsoLocal()
  const meal: MealPlanEntryView | undefined = plan?.entries.find(
    (e) => e.date === today,
  )
  const recipe = meal?.recipe ?? null

  async function run(action: () => Promise<MealPlanDetail>) {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      setPlan(next)
      setSwapOpen(false)
      setSwapOptions([])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function openSwap() {
    if (!plan || !meal) return
    setSwapOpen(true)
    setSwapLoading(true)
    setError(null)
    try {
      const options = await fetchSwapOptions(plan.id, meal.id, true)
      setSwapOptions(options)
    } catch (err) {
      setSwapOpen(false)
      setError(
        err instanceof ApiError ? err.message : 'Could not load swap options',
      )
    } finally {
      setSwapLoading(false)
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <p className="page-kicker">Tonight</p>
        <h1 className="page-title">What&apos;s for dinner</h1>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !plan ? (
        <p className="muted">Loading…</p>
      ) : (
        <section className="tonight-card" aria-labelledby="tonight-meal">
          <h2 id="tonight-meal" className="tonight-meal-name">
            {meal ? entryTitle(meal) : 'No meal planned'}
          </h2>
          {recipe ? (
            <p className="tonight-meta">
              {[
                recipe.prep_minutes != null || recipe.cook_minutes != null
                  ? `${(recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)} min`
                  : null,
                meal?.servings != null
                  ? `${meal.servings} servings`
                  : recipe.servings != null
                    ? `${recipe.servings} servings`
                    : null,
                meal?.active_minutes != null
                  ? `${meal.active_minutes} min active`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : meal?.notes ? (
            <p className="tonight-note">{meal.notes}</p>
          ) : null}

          {meal?.busy ? (
            <p className="tonight-note">
              <span className="busy-tag">Busy night</span>
            </p>
          ) : null}

          <div className="action-row">
            {recipe ? (
              <Link
                to={
                  meal?.servings != null
                    ? `/recipes/${recipe.id}/cook?servings=${meal.servings}`
                    : `/recipes/${recipe.id}/cook`
                }
                className="btn btn-primary"
              >
                Start cooking
              </Link>
            ) : (
              <Link to="/plan" className="btn btn-primary">
                Open plan
              </Link>
            )}
            {meal && plan ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void openSwap()}
                >
                  Swap
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      patchPlanEntry(plan.id, meal.id, {
                        status: 'leftovers',
                        recipe_id: null,
                        notes: 'Leftovers',
                      }),
                    )
                  }
                >
                  Mark leftovers
                </button>
              </>
            ) : null}
          </div>

          {swapOpen && meal && plan ? (
            <div className="swap-panel">
              {swapLoading ? (
                <p className="muted">Finding alternatives…</p>
              ) : swapOptions.length === 0 ? (
                <p className="muted">No alternatives in the library.</p>
              ) : (
                <ul className="plain-list">
                  {swapOptions.map((opt) => (
                    <li key={opt.id} className="plain-list-item">
                      <span>{opt.title}</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            patchPlanEntry(plan.id, meal.id, {
                              recipe_id: opt.id,
                              status: 'planned',
                              servings: opt.servings,
                              notes: null,
                            }),
                          )
                        }
                      >
                        Use
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSwapOpen(false)
                  setSwapOptions([])
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </section>
      )}
    </main>
  )
}
