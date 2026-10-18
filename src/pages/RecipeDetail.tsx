import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type {
  MealPlanDetail,
  MealPlanEntryView,
  RecipeDetail as RecipeDetailType,
  RecipeStatus,
} from '../../shared/types'
import { RecipeForm } from '../components/RecipeForm'
import { ApiError, api } from '../lib/api'
import {
  currentWeekStartLocal,
  entryTitle,
  fetchCurrentPlan,
  formatDayOption,
  nextWeekStartLocal,
  patchPlanEntry,
} from '../lib/plans'
import {
  emptyRecipeForm,
  formToPayload,
  formatIngredientLine,
  formatMinutes,
  ingredientsToText,
  RECIPE_STATUS_LABELS,
  RECIPE_STATUS_OPTIONS,
  scaleQuantity,
  type RecipeFormState,
} from '../lib/recipes'

type PlanDayOption = {
  planId: string
  entry: MealPlanEntryView
  weekLabel: 'This week' | 'Next week'
}

export function RecipeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<RecipeDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<RecipeFormState>(emptyRecipeForm())
  const [saving, setSaving] = useState(false)
  const [scaleServings, setScaleServings] = useState<number | null>(null)
  const [addToPlanOpen, setAddToPlanOpen] = useState(false)
  const [planDays, setPlanDays] = useState<PlanDayOption[]>([])
  const [planDaysLoading, setPlanDaysLoading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [assignMessage, setAssignMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    api<{ recipe: RecipeDetailType }>(`/api/recipes/${id}`)
      .then((res) => {
        if (cancelled) return
        setRecipe(res.recipe)
        setScaleServings(res.recipe.servings)
        setForm(
          emptyRecipeForm({
            title: res.recipe.title,
            source_url: res.recipe.source_url ?? '',
            servings:
              res.recipe.servings != null ? String(res.recipe.servings) : '',
            prep_minutes:
              res.recipe.prep_minutes != null
                ? String(res.recipe.prep_minutes)
                : '',
            cook_minutes:
              res.recipe.cook_minutes != null
                ? String(res.recipe.cook_minutes)
                : '',
            instructions: res.recipe.instructions ?? '',
            notes: res.recipe.notes ?? '',
            tags: res.recipe.tags.join(', '),
            status: res.recipe.status,
            ingredientsText: ingredientsToText(res.recipe.ingredients),
          }),
        )
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load recipe',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const scaledIngredients = useMemo(() => {
    if (!recipe) return []
    const target = scaleServings ?? recipe.servings ?? 1
    return recipe.ingredients.map((ing) => ({
      ...ing,
      scaled: scaleQuantity(ing.quantity, recipe.servings, target),
    }))
  }, [recipe, scaleServings])

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    setError(null)
    try {
      const payload = formToPayload(form)
      if (!payload.title) {
        setError('Title is required')
        return
      }
      const res = await api<{ recipe: RecipeDetailType }>(`/api/recipes/${id}`, {
        method: 'PATCH',
        body: payload,
      })
      setRecipe(res.recipe)
      setScaleServings(res.recipe.servings)
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(status: RecipeStatus) {
    if (!id || !recipe) return
    setError(null)
    try {
      const res = await api<{ recipe: RecipeDetailType }>(`/api/recipes/${id}`, {
        method: 'PATCH',
        body: { status },
      })
      setRecipe(res.recipe)
      setForm((f) => ({ ...f, status: res.recipe.status }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update status')
    }
  }

  async function remove() {
    if (!id || !recipe) return
    if (!window.confirm(`Delete “${recipe.title}”?`)) return
    try {
      await api<{ ok: boolean }>(`/api/recipes/${id}`, { method: 'DELETE' })
      navigate('/recipes', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete')
    }
  }

  async function openAddToPlan() {
    setAddToPlanOpen(true)
    setAssignMessage(null)
    setPlanDaysLoading(true)
    setError(null)
    try {
      const thisWeekStart = currentWeekStartLocal()
      const nextWeekStart = nextWeekStartLocal()
      const [thisWeek, nextWeek] = await Promise.all([
        fetchCurrentPlan(thisWeekStart),
        fetchCurrentPlan(nextWeekStart),
      ])
      const options: PlanDayOption[] = [
        ...planDayOptions(thisWeek, 'This week'),
        ...planDayOptions(nextWeek, 'Next week'),
      ]
      setPlanDays(options)
    } catch (err) {
      setAddToPlanOpen(false)
      setError(
        err instanceof ApiError ? err.message : 'Could not load meal plans',
      )
    } finally {
      setPlanDaysLoading(false)
    }
  }

  async function assignToDay(opt: PlanDayOption) {
    if (!recipe) return
    setAssigning(true)
    setError(null)
    setAssignMessage(null)
    try {
      await patchPlanEntry(opt.planId, opt.entry.id, {
        recipe_id: recipe.id,
        status: 'planned',
        servings: recipe.servings,
        notes: null,
      })
      setAssignMessage(
        `Added to ${formatDayOption(opt.entry.date)} (${opt.weekLabel.toLowerCase()}).`,
      )
      setAddToPlanOpen(false)
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not add to plan',
      )
    } finally {
      setAssigning(false)
    }
  }

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Loading recipe…</p>
      </main>
    )
  }

  if (!recipe) {
    return (
      <main className="page">
        <p className="auth-error" role="alert">
          {error ?? 'Recipe not found'}
        </p>
        <Link to="/recipes" className="btn btn-secondary btn-sm">
          Back to recipes
        </Link>
      </main>
    )
  }

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/recipes">Recipes</Link>
        <span aria-hidden="true"> / </span>
        <span>{recipe.title}</span>
      </p>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {editing ? (
        <form className="recipe-edit" onSubmit={saveEdit}>
          <header className="page-header">
            <p className="page-kicker">Edit</p>
            <h1 className="page-title">Edit recipe</h1>
          </header>
          <RecipeForm form={form} onChange={setForm} idPrefix="edit" />
          <div className="action-row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <header className="page-header">
            <p className="page-kicker">
              {RECIPE_STATUS_LABELS[recipe.status]}
              {recipe.status === 'favorite' ? ' ★' : ''}
            </p>
            <h1 className="page-title">{recipe.title}</h1>
            <p className="page-lede">
              {formatMinutes(recipe.prep_minutes, recipe.cook_minutes)}
              {recipe.servings != null ? ` · base ${recipe.servings} servings` : ''}
            </p>
            {recipe.source_url ? (
              <p className="muted">
                <a href={recipe.source_url} target="_blank" rel="noreferrer">
                  Source
                </a>
              </p>
            ) : null}
          </header>

          <div className="action-row compact">
            <Link
              to={
                scaleServings != null
                  ? `/recipes/${recipe.id}/cook?servings=${scaleServings}`
                  : `/recipes/${recipe.id}/cook`
              }
              className="btn btn-primary btn-sm"
            >
              Start cooking
            </Link>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={assigning}
              onClick={() => void openAddToPlan()}
            >
              Add to plan
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void remove()}
            >
              Delete
            </button>
          </div>

          {assignMessage ? (
            <p className="muted">
              {assignMessage}{' '}
              <Link to="/plan">View plan</Link>
            </p>
          ) : null}

          {addToPlanOpen ? (
            <div className="swap-panel">
              <p className="day-card-day">Pick a day</p>
              {planDaysLoading ? (
                <p className="muted">Loading weeks…</p>
              ) : (
                <>
                  {(['This week', 'Next week'] as const).map((weekLabel) => {
                    const days = planDays.filter((d) => d.weekLabel === weekLabel)
                    if (days.length === 0) return null
                    return (
                      <div key={weekLabel}>
                        <p className="day-card-day">{weekLabel}</p>
                        <ul className="plain-list">
                          {days.map((opt) => (
                            <li key={opt.entry.id} className="plain-list-item">
                              <span>
                                {formatDayOption(opt.entry.date)}
                                <span className="muted">
                                  {' '}
                                  · {entryTitle(opt.entry)}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                disabled={assigning}
                                onClick={() => void assignToDay(opt)}
                              >
                                Add
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={assigning}
                onClick={() => setAddToPlanOpen(false)}
              >
                Cancel
              </button>
            </div>
          ) : null}

          <section className="page-section">
            <h2 className="section-title">Status</h2>
            <div className="status-chips">
              {RECIPE_STATUS_OPTIONS.filter((s) => s !== 'archived').map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    className={
                      recipe.status === status
                        ? 'status-chip status-chip-active'
                        : 'status-chip'
                    }
                    onClick={() => void setStatus(status)}
                  >
                    {RECIPE_STATUS_LABELS[status]}
                  </button>
                ),
              )}
            </div>
          </section>

          <section className="page-section">
            <div className="scale-row">
              <h2 className="section-title">Ingredients</h2>
              <label className="scale-control">
                <span>Servings</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="scale-input"
                  value={scaleServings ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setScaleServings(Number.isFinite(n) && n > 0 ? n : null)
                  }}
                />
              </label>
            </div>
            <p className="muted scale-note">
              Scaled from the recipe&apos;s base servings.
            </p>
            <ul className="ingredient-list">
              {scaledIngredients.map((ing) => (
                <li key={ing.id}>
                  {formatIngredientLine(ing, ing.scaled)}
                </li>
              ))}
              {scaledIngredients.length === 0 ? (
                <li className="muted">No ingredients listed.</li>
              ) : null}
            </ul>
          </section>

          {recipe.instructions ? (
            <section className="page-section">
              <h2 className="section-title">Instructions</h2>
              <div className="instructions-block">
                {recipe.instructions.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </section>
          ) : null}

          {recipe.notes ? (
            <section className="page-section">
              <h2 className="section-title">Notes</h2>
              <p className="notes-block">{recipe.notes}</p>
            </section>
          ) : null}

          {recipe.tags.length > 0 ? (
            <section className="page-section">
              <h2 className="section-title">Tags</h2>
              <p className="recipe-tags">
                {recipe.tags.map((t) => (
                  <span key={t} className="recipe-tag">
                    {t}
                  </span>
                ))}
              </p>
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}

function planDayOptions(
  plan: MealPlanDetail,
  weekLabel: 'This week' | 'Next week',
): PlanDayOption[] {
  return plan.entries.map((entry) => ({
    planId: plan.id,
    entry,
    weekLabel,
  }))
}
