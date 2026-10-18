import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { RecipeDetail, RecipeDraft } from '../../shared/types'
import { RecipeForm } from '../components/RecipeForm'
import { ApiError, api } from '../lib/api'
import {
  emptyRecipeForm,
  formToPayload,
  ingredientsToText,
  type RecipeFormState,
} from '../lib/recipes'

type Mode = 'manual' | 'import'

export function RecipeNew({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const [form, setForm] = useState<RecipeFormState>(
    emptyRecipeForm({ status: mode === 'import' ? 'draft' : 'active' }),
  )
  const [importUrl, setImportUrl] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(mode === 'manual')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function runImport(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setImportMessage(null)
    setBusy(true)
    try {
      const res = await api<
        | { status: 'ok'; draft: RecipeDraft }
        | {
            status: 'needs_review'
            url: string
            extracted: Partial<RecipeDraft>
            message: string
          }
      >('/api/recipes/import', {
        method: 'POST',
        body: { url: importUrl.trim() },
      })

      const draft =
        res.status === 'ok'
          ? res.draft
          : {
              title: res.extracted.title ?? '',
              source_url: res.url,
              servings: res.extracted.servings ?? null,
              prep_minutes: res.extracted.prep_minutes ?? null,
              cook_minutes: res.extracted.cook_minutes ?? null,
              instructions: res.extracted.instructions ?? null,
              notes: res.extracted.notes ?? null,
              tags: res.extracted.tags ?? [],
              status: 'draft' as const,
              ingredients: res.extracted.ingredients ?? [],
            }

      setForm(
        emptyRecipeForm({
          title: draft.title,
          source_url: draft.source_url ?? importUrl.trim(),
          servings: draft.servings != null ? String(draft.servings) : '',
          prep_minutes:
            draft.prep_minutes != null ? String(draft.prep_minutes) : '',
          cook_minutes:
            draft.cook_minutes != null ? String(draft.cook_minutes) : '',
          instructions: draft.instructions ?? '',
          notes: draft.notes ?? '',
          tags: (draft.tags ?? []).join(', '),
          status: draft.status ?? 'draft',
          ingredientsText: ingredientsToText(draft.ingredients ?? []),
        }),
      )
      setShowForm(true)
      if (res.status === 'needs_review') {
        setImportMessage(res.message)
      } else {
        setImportMessage('Extracted a draft — review before saving.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const payload = formToPayload(form)
    if (!payload.title) {
      setError('Title is required')
      return
    }
    setBusy(true)
    try {
      const res = await api<{ recipe: RecipeDetail }>('/api/recipes', {
        method: 'POST',
        body: payload,
      })
      navigate(`/recipes/${res.recipe.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save recipe')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <p className="breadcrumb">
        <Link to="/recipes">Recipes</Link>
        <span aria-hidden="true"> / </span>
        <span>{mode === 'import' ? 'Import' : 'New'}</span>
      </p>

      <header className="page-header">
        <p className="page-kicker">Library</p>
        <h1 className="page-title">
          {mode === 'import' ? 'Import from URL' : 'Add recipe'}
        </h1>
        <p className="page-lede">
          {mode === 'import'
            ? 'Fetch a page, review the draft, then save to your household.'
            : 'Create a recipe manually for this household.'}
        </p>
      </header>

      {mode === 'import' ? (
        <form className="import-url-form" onSubmit={(e) => void runImport(e)}>
          <label className="auth-field" htmlFor="import-url">
            <span>Recipe URL</span>
            <input
              id="import-url"
              type="url"
              required
              placeholder="https://…"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={busy}
          >
            {busy && !showForm ? 'Fetching…' : 'Extract draft'}
          </button>
        </form>
      ) : null}

      {importMessage ? (
        <p className="import-banner" role="status">
          {importMessage}
        </p>
      ) : null}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <form className="recipe-edit" onSubmit={(e) => void save(e)}>
          <RecipeForm
            form={form}
            onChange={setForm}
            idPrefix={mode === 'import' ? 'import' : 'new'}
          />
          <div className="action-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save recipe'}
            </button>
            <Link to="/recipes" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      ) : null}
    </main>
  )
}
