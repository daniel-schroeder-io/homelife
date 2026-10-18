import type {
  MealPlanDetail,
  MealPlanEntryStatus,
  MealPlanEntryView,
  MealPlanRecipeSummary,
} from '../../shared/types'
import { api } from './api'

export async function fetchCurrentPlan(
  weekStart?: string,
): Promise<MealPlanDetail> {
  const q = weekStart
    ? `?week_start=${encodeURIComponent(weekStart)}`
    : ''
  const res = await api<{ plan: MealPlanDetail }>(`/api/plans/current${q}`)
  return res.plan
}

export async function generatePlanDraft(opts?: {
  week_start?: string
  cooked_dinners?: number
}): Promise<MealPlanDetail> {
  const res = await api<{ plan: MealPlanDetail }>('/api/plans/generate', {
    method: 'POST',
    body: opts ?? {},
  })
  return res.plan
}

export async function approvePlan(planId: string): Promise<MealPlanDetail> {
  const res = await api<{ plan: MealPlanDetail }>(`/api/plans/${planId}`, {
    method: 'PATCH',
    body: { status: 'approved' },
  })
  return res.plan
}

export async function patchPlanEntry(
  planId: string,
  entryId: string,
  body: {
    recipe_id?: string | null
    status?: MealPlanEntryStatus
    meal_type?: string
    servings?: number | null
    notes?: string | null
    date?: string
  },
): Promise<MealPlanDetail> {
  const res = await api<{ plan: MealPlanDetail }>(
    `/api/plans/${planId}/entries/${entryId}`,
    { method: 'PATCH', body },
  )
  return res.plan
}

export async function fetchSwapOptions(
  planId: string,
  entryId: string,
  preferQuick = false,
): Promise<MealPlanRecipeSummary[]> {
  const res = await api<{ options: MealPlanRecipeSummary[] }>(
    `/api/plans/${planId}/entries/${entryId}/swap-options`,
    {
      method: 'POST',
      body: preferQuick ? { prefer_quick: true } : {},
    },
  )
  return res.options
}

export async function regenerateEntry(
  planId: string,
  entryId: string,
): Promise<MealPlanDetail> {
  const res = await api<{ plan: MealPlanDetail }>(
    `/api/plans/${planId}/entries/${entryId}/regenerate`,
    { method: 'POST', body: {} },
  )
  return res.plan
}

export function entryTitle(entry: MealPlanEntryView): string {
  if (entry.status === 'leftovers') return entry.notes ?? 'Leftovers'
  if (entry.status === 'eating_out') return entry.notes ?? 'Eating out'
  if (entry.status === 'quick') return entry.notes ?? 'Quick / freezer'
  if (entry.status === 'undecided') return 'Undecided'
  if (entry.recipe) return entry.recipe.title
  return 'Open night'
}

export function statusLabel(
  entry: MealPlanEntryView,
  planStatus: string,
): string {
  if (entry.status === 'leftovers') return 'Leftovers'
  if (entry.status === 'eating_out') return 'Out'
  if (entry.status === 'quick') return 'Quick'
  if (entry.status === 'undecided') return 'Open'
  if (planStatus === 'approved' && entry.status === 'planned') return 'Set'
  if (entry.status === 'planned') return 'Draft'
  return entry.status
}

export function pillClass(entry: MealPlanEntryView, planStatus: string): string {
  if (entry.status === 'leftovers') return 'pill pill-leftovers'
  if (entry.status === 'eating_out') return 'pill pill-out'
  if (entry.status === 'quick') return 'pill pill-quick'
  if (entry.status === 'undecided') return 'pill pill-empty'
  if (planStatus === 'approved') return 'pill pill-accepted'
  return 'pill pill-draft'
}

export function formatWeekLabel(weekStart: string): string {
  const dates = weekDates(weekStart)
  const start = formatShortDate(dates[0]!)
  const end = formatShortDate(dates[6]!)
  return `${start} – ${end}`
}

export function weekDates(weekStart: string): string[] {
  const [y, m, d] = weekStart.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i))
    out.push(dt.toISOString().slice(0, 10))
  }
  return out
}

export function shortDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(dt)
}

export function todayIsoLocal(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Monday (ISO) of the week containing `isoDate` (YYYY-MM-DD). */
export function mondayOfIso(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diff)
  return dt.toISOString().slice(0, 10)
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function currentWeekStartLocal(): string {
  return mondayOfIso(todayIsoLocal())
}

export function nextWeekStartLocal(): string {
  return addDaysIso(currentWeekStartLocal(), 7)
}

export function formatDayOption(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const dt = new Date(Date.UTC(y, m - 1, d))
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}
