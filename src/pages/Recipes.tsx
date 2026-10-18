import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { RecipeView } from '../../shared/types'
import { ApiError, api } from '../lib/api'
import { formatMinutes, RECIPE_STATUS_LABELS } from '../lib/recipes'

export function Recipes() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [recipes, setRecipes] = useState<RecipeView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const path = debounced
      ? `/api/recipes?q=${encodeURIComponent(debounced)}`
      : '/api/recipes'

    api<{ recipes: RecipeView[] }>(path)
      .then((res) => {
        if (!cancelled) setRecipes(res.recipes)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : 'Could not load recipes',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [debounced])

  return (
    <main className="page">
      <header className="page-header">
        <p className="page-kicker">Library</p>
        <h1 className="page-title">Recipes</h1>
        <p className="page-lede">Saved dinners for this household — not a feed.</p>
      </header>

      <div className="toolbar">
        <label className="sr-only" htmlFor="recipe-search">
          Search recipes
        </label>
        <input
          id="recipe-search"
          type="search"
          className="search-input"
          placeholder="Search title, ingredient, or tag…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="action-row compact">
          <Link to="/recipes/new" className="btn btn-primary btn-sm">
            Add recipe
          </Link>
          <Link to="/recipes/import" className="btn btn-secondary btn-sm">
            Import URL
          </Link>
        </div>
      </div>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <p className="muted">Loading recipes…</p> : null}

      {!loading && !error ? (
        <ul className="recipe-list">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <Link to={`/recipes/${recipe.id}`} className="recipe-row recipe-row-link">
                <div>
                  <p className="recipe-title">
                    {recipe.title}
                    {recipe.status === 'favorite' ? (
                      <span className="favorite-mark" aria-label="Favorite">
                        {' '}
                        ★
                      </span>
                    ) : null}
                  </p>
                  <p className="muted">
                    {formatMinutes(recipe.prep_minutes, recipe.cook_minutes)}
                    {recipe.servings != null
                      ? ` · serves ${recipe.servings}`
                      : ''}
                    {' · '}
                    {RECIPE_STATUS_LABELS[recipe.status]}
                  </p>
                  {recipe.tags.length > 0 ? (
                    <p className="recipe-tags">
                      {recipe.tags.map((t) => (
                        <span key={t} className="recipe-tag">
                          {t}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
          {recipes.length === 0 ? (
            <li className="muted empty-state">
              {debounced
                ? 'No recipes match that search.'
                : 'No recipes yet — add one or import a URL.'}
            </li>
          ) : null}
        </ul>
      ) : null}
    </main>
  )
}
