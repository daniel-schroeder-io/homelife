import type { PrepTaskStatus, PrepTaskView, PrepWeek } from '../../shared/types'
import { api } from './api'

export async function fetchPrep(weekStart?: string): Promise<PrepWeek> {
  const q = weekStart
    ? `?week_start=${encodeURIComponent(weekStart)}`
    : ''
  const res = await api<{ prep: PrepWeek }>(`/api/prep${q}`)
  return res.prep
}

export async function generatePrep(weekStart?: string): Promise<PrepWeek> {
  const res = await api<{ prep: PrepWeek }>('/api/prep/generate', {
    method: 'POST',
    body: weekStart ? { week_start: weekStart } : {},
  })
  return res.prep
}

export async function patchPrepTask(
  id: string,
  body: {
    title?: string
    status?: PrepTaskStatus
    notes?: string | null
    duration_minutes?: number | null
    scheduled_for?: string | null
    effort?: 'active' | 'passive' | null
  },
): Promise<PrepTaskView> {
  const res = await api<{ task: PrepTaskView }>(
    `/api/prep/${encodeURIComponent(id)}`,
    { method: 'PATCH', body },
  )
  return res.task
}

export async function deletePrepTask(id: string): Promise<void> {
  await api<{ ok: boolean }>(`/api/prep/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function formatPrepWhen(isoDate: string | null): string {
  if (!isoDate) return 'Anytime'
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

export function effortLabel(
  effort: PrepTaskView['effort'],
): string | null {
  if (effort === 'active') return 'Active'
  if (effort === 'passive') return 'Passive'
  return null
}
