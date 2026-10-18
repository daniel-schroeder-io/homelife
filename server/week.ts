/** Monday (ISO) of the week containing `isoDate` (YYYY-MM-DD). */
export function mondayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay() // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day
  dt.setUTCDate(dt.getUTCDate() + diff)
  return dt.toISOString().slice(0, 10)
}

export function datesForWeek(weekStart: string): string[] {
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

export function todayInTimezone(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const y = parts.find((p) => p.type === 'year')?.value
    const mo = parts.find((p) => p.type === 'month')?.value
    const da = parts.find((p) => p.type === 'day')?.value
    if (y && mo && da) return `${y}-${mo}-${da}`
  } catch {
    // fall through
  }
  return new Date().toISOString().slice(0, 10)
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}
