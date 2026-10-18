import { useCallback, useEffect, useState } from 'react'
import type {
  MealPlanDetail,
  MealPlanEntryView,
  MealPlanRecipeSummary,
  RecipeView,
} from '../../shared/types'
import { WeekSwitcher } from '../components/WeekSwitcher'
import { ApiError, api } from '../lib/api'
import {
  approvePlan,
  entryTitle,
  fetchCurrentPlan,
  fetchSwapOptions,
  formatWeekLabel,
  generatePlanDraft,
  patchPlanEntry,
  pillClass,
  regenerateEntry,
  shortDay,
  statusLabel,
  todayIsoLocal,
} from '../lib/plans'
import { subscribePlanStream } from '../lib/planSync'
import { useSelectedWeek } from '../lib/weekSelection'

export function Plan() {
  const { weekStart, setWeekStart, thisWeek, nextWeek, isNextWeek } =
    useSelectedWeek()
  const [plan, setPlan] = useState<MealPlanDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [swapFor, setSwapFor] = useState<string | null>(null)
  const [swapOptions, setSwapOptions] = useState<MealPlanRecipeSummary[]>([])
  const [swapLoading, setSwapLoading] = useState(false)
  const [chooseFor, setChooseFor] = useState<string | null>(null)
  const [recipeQuery, setRecipeQuery] = useState('')
  const [recipeDebounced, setRecipeDebounced] = useState('')
  const [recipeOptions, setRecipeOptions] = useState<RecipeView[]>([])
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [moreFor, setMoreFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPlan(null)
    setSwapFor(null)
    setSwapOptions([])
    setChooseFor(null)
    setRecipeQuery('')
    setRecipeOptions([])
    setMoreFor(null)
    try {
      const next = await fetchCurrentPlan(weekStart)
      setPlan(next)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load meal plan',
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

  useEffect(() => {
    const t = window.setTimeout(
      () => setRecipeDebounced(recipeQuery.trim()),
      250,
    )
    return () => window.clearTimeout(t)
  }, [recipeQuery])

  useEffect(() => {
    if (!chooseFor) return
    let cancelled = false
    setRecipeLoading(true)
    const path = recipeDebounced
      ? `/api/recipes?q=${encodeURIComponent(recipeDebounced)}`
      : '/api/recipes'
    api<{ recipes: RecipeView[] }>(path)
      .then((res) => {
        if (!cancelled) setRecipeOptions(res.recipes)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not load recipes',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setRecipeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chooseFor, recipeDebounced])

  async function run(action: () => Promise<MealPlanDetail>) {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      setPlan(next)
      setSwapFor(null)
      setSwapOptions([])
      setChooseFor(null)
      setRecipeQuery('')
      setRecipeOptions([])
      setMoreFor(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  function closePanels() {
    setSwapFor(null)
    setSwapOptions([])
    setChooseFor(null)
    setRecipeQuery('')
    setRecipeOptions([])
    setMoreFor(null)
  }

  async function openSwap(entry: MealPlanEntryView) {
    if (!plan) return
    setChooseFor(null)
    setMoreFor(null)
    setRecipeQuery('')
    setRecipeOptions([])
    setSwapFor(entry.id)
    setSwapLoading(true)
    setError(null)
    try {
      const options = await fetchSwapOptions(
        plan.id,
        entry.id,
        entry.busy || entry.status === 'quick',
      )
      setSwapOptions(options)
    } catch (err) {
      setSwapFor(null)
      setError(
        err instanceof ApiError ? err.message : 'Could not load swap options',
      )
    } finally {
      setSwapLoading(false)
    }
  }

  function openChoose(entry: MealPlanEntryView) {
    setSwapFor(null)
    setSwapOptions([])
    setMoreFor(null)
    setRecipeQuery('')
    setRecipeDebounced('')
    setChooseFor(entry.id)
  }

  function toggleMore(entryId: string) {
    setSwapFor(null)
    setSwapOptions([])
    setChooseFor(null)
    setMoreFor((prev) => (prev === entryId ? null : entryId))
  }

  const today = todayIsoLocal()

  return (
    <main className="page">
      <header className="page-header">
        <p className="page-kicker">
          {plan ? `Week of ${formatWeekLabel(plan.week_start)}` : 'Meal plan'}
        </p>
        <h1 className="page-title">Meal plan</h1>
        <p className="page-lede">
          {isNextWeek
            ? 'Plan dinners for the upcoming week. Accept what works, swap what doesn\u2019t.'
            : 'Draft dinners for this week. Accept what works, swap what doesn\u2019t.'}
        </p>
      </header>

      <WeekSwitcher
        thisWeek={thisWeek}
        nextWeek={nextWeek}
        value={weekStart}
        onChange={setWeekStart}
        disabled={busy}
      />

      <div className="action-row compact plan-toolbar">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || loading}
          onClick={() =>
            void run(() => generatePlanDraft({ week_start: weekStart }))
          }
        >
          Generate draft
        </button>
        {plan && plan.status === 'draft' ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || loading}
            onClick={() => void run(() => approvePlan(plan.id))}
          >
            Accept plan
          </button>
        ) : null}
        {plan && plan.status === 'approved' ? (
          <span className="pill pill-accepted">Approved</span>
        ) : null}
      </div>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !plan ? (
        <p className="muted">Loading week…</p>
      ) : plan ? (
        <div className="day-grid">
          {plan.entries.map((entry) => {
            const title = entryTitle(entry)
            const isTonight = entry.date === today
            const showSwapPanel = swapFor === entry.id
            const showMore = moreFor === entry.id

            return (
              <article
                key={entry.id}
                className={`day-card${isTonight ? ' day-card-tonight' : ''}`}
              >
                <div className="day-card-top">
                  <div>
                    <p className="day-card-day">
                      {shortDay(entry.date)}
                      {isTonight ? ' · Tonight' : ''}
                    </p>
                    <h2 className="day-card-title">{title}</h2>
                  </div>
                  <span className={pillClass(entry, plan.status)}>
                    {statusLabel(entry, plan.status)}
                  </span>
                </div>

                <p className="day-card-meta">
                  {entry.busy ? (
                    <span className="busy-tag">Busy night</span>
                  ) : null}
                  {entry.recipe
                    ? [
                        entry.active_minutes != null
                          ? `${entry.active_minutes} min active`
                          : null,
                        entry.total_minutes != null
                          ? `${entry.total_minutes} min total`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Time not set'
                    : entry.notes && entry.status !== 'planned'
                      ? entry.notes
                      : 'No recipe'}
                </p>

                <div className="action-row compact day-card-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => openChoose(entry)}
                  >
                    Choose
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void openSwap(entry)}
                  >
                    Swap
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() => regenerateEntry(plan.id, entry.id))
                    }
                  >
                    Regen
                  </button>
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm${showMore ? ' is-open' : ''}`}
                    disabled={busy}
                    aria-expanded={showMore}
                    onClick={() => toggleMore(entry.id)}
                  >
                    More
                  </button>
                </div>

                {showMore ? (
                  <div className="day-card-more" role="group" aria-label="More actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || entry.sort_order <= 0}
                      aria-label="Move to previous day"
                      onClick={() => {
                        const prev = plan.entries.find(
                          (e) => e.sort_order === entry.sort_order - 1,
                        )
                        if (!prev) return
                        void run(() =>
                          patchPlanEntry(plan.id, entry.id, {
                            date: prev.date,
                          }),
                        )
                      }}
                    >
                      ← Day
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={
                        busy || entry.sort_order >= plan.entries.length - 1
                      }
                      aria-label="Move to next day"
                      onClick={() => {
                        const next = plan.entries.find(
                          (e) => e.sort_order === entry.sort_order + 1,
                        )
                        if (!next) return
                        void run(() =>
                          patchPlanEntry(plan.id, entry.id, {
                            date: next.date,
                          }),
                        )
                      }}
                    >
                      Day →
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          patchPlanEntry(plan.id, entry.id, {
                            status: 'leftovers',
                            recipe_id: null,
                            notes: 'Leftovers',
                          }),
                        )
                      }
                    >
                      Leftovers
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          patchPlanEntry(plan.id, entry.id, {
                            status: 'quick',
                            recipe_id: null,
                            notes: 'Quick / freezer',
                          }),
                        )
                      }
                    >
                      Quick
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          patchPlanEntry(plan.id, entry.id, {
                            status: 'eating_out',
                            recipe_id: null,
                            notes: 'Eating out',
                          }),
                        )
                      }
                    >
                      Out
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          patchPlanEntry(plan.id, entry.id, {
                            status: 'undecided',
                            recipe_id: null,
                            notes: null,
                          }),
                        )
                      }
                    >
                      Open
                    </button>
                  </div>
                ) : null}

                {showSwapPanel ? (
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
                                  patchPlanEntry(plan.id, entry.id, {
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
                      onClick={closePanels}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}

                {chooseFor === entry.id ? (
                  <div className="swap-panel">
                    <label className="sr-only" htmlFor={`choose-recipe-${entry.id}`}>
                      Search recipes
                    </label>
                    <input
                      id={`choose-recipe-${entry.id}`}
                      type="search"
                      className="search-input"
                      placeholder="Search library…"
                      value={recipeQuery}
                      onChange={(e) => setRecipeQuery(e.target.value)}
                      autoFocus
                    />
                    {recipeLoading ? (
                      <p className="muted">Loading recipes…</p>
                    ) : recipeOptions.length === 0 ? (
                      <p className="muted">No recipes match.</p>
                    ) : (
                      <ul className="plain-list">
                        {recipeOptions.map((opt) => (
                          <li key={opt.id} className="plain-list-item">
                            <span>{opt.title}</span>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  patchPlanEntry(plan.id, entry.id, {
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
                      onClick={closePanels}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}
    </main>
  )
}
