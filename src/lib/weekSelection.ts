import { useCallback, useState } from 'react'
import {
  addDaysIso,
  currentWeekStartLocal,
  mondayOfIso,
  nextWeekStartLocal,
  todayIsoLocal,
} from './plans'

const STORAGE_KEY = 'homelife.selectedWeekStart'

function localWeekday(isoDate: string = todayIsoLocal()): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Default week for planning/shopping when the UI hasn't chosen one yet.
 * Fri–Sun → upcoming week (households typically plan ahead on the weekend).
 * Mon–Thu → current week.
 */
export function defaultPlanningWeekStartLocal(
  isoDate: string = todayIsoLocal(),
): string {
  const day = localWeekday(isoDate)
  const thisWeek = mondayOfIso(isoDate)
  if (day === 0 || day === 5 || day === 6) {
    return addDaysIso(thisWeek, 7)
  }
  return thisWeek
}

function isSelectableWeek(weekStart: string): boolean {
  return (
    weekStart === currentWeekStartLocal() ||
    weekStart === nextWeekStartLocal()
  )
}

function readStoredWeek(): string | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored && isSelectableWeek(stored)) return stored
  } catch {
    /* private mode / unavailable */
  }
  return null
}

function writeStoredWeek(weekStart: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, weekStart)
  } catch {
    /* ignore */
  }
}

export function useSelectedWeek() {
  const thisWeek = currentWeekStartLocal()
  const nextWeek = nextWeekStartLocal()
  const [weekStart, setWeekStartState] = useState(
    () => readStoredWeek() ?? defaultPlanningWeekStartLocal(),
  )

  const setWeekStart = useCallback((next: string) => {
    if (!isSelectableWeek(next)) return
    writeStoredWeek(next)
    setWeekStartState(next)
  }, [])

  return {
    weekStart,
    setWeekStart,
    thisWeek,
    nextWeek,
    isNextWeek: weekStart === nextWeek,
  }
}
