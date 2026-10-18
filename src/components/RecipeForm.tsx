import type { RecipeFormState } from '../lib/recipes'
import { RECIPE_STATUS_LABELS, RECIPE_STATUS_OPTIONS } from '../lib/recipes'

type Props = {
  form: RecipeFormState
  onChange: (next: RecipeFormState) => void
  idPrefix?: string
}

export function RecipeForm({ form, onChange, idPrefix = 'recipe' }: Props) {
  function set<K extends keyof RecipeFormState>(
    key: K,
    value: RecipeFormState[K],
  ) {
    onChange({ ...form, [key]: value })
  }

  return (
    <div className="recipe-form">
      <label className="auth-field" htmlFor={`${idPrefix}-title`}>
        <span>Title</span>
        <input
          id={`${idPrefix}-title`}
          required
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </label>

      <label className="auth-field" htmlFor={`${idPrefix}-source`}>
        <span>Source URL</span>
        <input
          id={`${idPrefix}-source`}
          type="url"
          placeholder="https://"
          value={form.source_url}
          onChange={(e) => set('source_url', e.target.value)}
        />
      </label>

      <div className="recipe-form-row">
        <label className="auth-field" htmlFor={`${idPrefix}-servings`}>
          <span>Servings</span>
          <input
            id={`${idPrefix}-servings`}
            inputMode="decimal"
            value={form.servings}
            onChange={(e) => set('servings', e.target.value)}
          />
        </label>
        <label className="auth-field" htmlFor={`${idPrefix}-prep`}>
          <span>Prep (min)</span>
          <input
            id={`${idPrefix}-prep`}
            inputMode="numeric"
            value={form.prep_minutes}
            onChange={(e) => set('prep_minutes', e.target.value)}
          />
        </label>
        <label className="auth-field" htmlFor={`${idPrefix}-cook`}>
          <span>Cook (min)</span>
          <input
            id={`${idPrefix}-cook`}
            inputMode="numeric"
            value={form.cook_minutes}
            onChange={(e) => set('cook_minutes', e.target.value)}
          />
        </label>
      </div>

      <label className="auth-field" htmlFor={`${idPrefix}-ingredients`}>
        <span>Ingredients (one per line)</span>
        <textarea
          id={`${idPrefix}-ingredients`}
          className="recipe-textarea"
          rows={8}
          placeholder={'1.5 lb chicken thighs, boneless\n2 heads broccoli'}
          value={form.ingredientsText}
          onChange={(e) => set('ingredientsText', e.target.value)}
        />
      </label>

      <label className="auth-field" htmlFor={`${idPrefix}-instructions`}>
        <span>Instructions</span>
        <textarea
          id={`${idPrefix}-instructions`}
          className="recipe-textarea"
          rows={8}
          value={form.instructions}
          onChange={(e) => set('instructions', e.target.value)}
        />
      </label>

      <label className="auth-field" htmlFor={`${idPrefix}-notes`}>
        <span>Notes</span>
        <textarea
          id={`${idPrefix}-notes`}
          className="recipe-textarea"
          rows={3}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </label>

      <label className="auth-field" htmlFor={`${idPrefix}-tags`}>
        <span>Tags (comma-separated)</span>
        <input
          id={`${idPrefix}-tags`}
          value={form.tags}
          onChange={(e) => set('tags', e.target.value)}
          placeholder="weeknight, sheet-pan"
        />
      </label>

      <label className="auth-field" htmlFor={`${idPrefix}-status`}>
        <span>Status</span>
        <select
          id={`${idPrefix}-status`}
          className="recipe-select"
          value={form.status}
          onChange={(e) =>
            set('status', e.target.value as RecipeFormState['status'])
          }
        >
          {RECIPE_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {RECIPE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
