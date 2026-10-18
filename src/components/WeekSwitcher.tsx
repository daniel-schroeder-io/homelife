import { formatWeekLabel } from '../lib/plans'

type WeekSwitcherProps = {
  thisWeek: string
  nextWeek: string
  value: string
  onChange: (weekStart: string) => void
  disabled?: boolean
}

export function WeekSwitcher({
  thisWeek,
  nextWeek,
  value,
  onChange,
  disabled,
}: WeekSwitcherProps) {
  return (
    <div
      className="week-switcher"
      role="group"
      aria-label="Select week"
    >
      <button
        type="button"
        className={
          value === thisWeek
            ? 'week-switcher-btn active'
            : 'week-switcher-btn'
        }
        disabled={disabled}
        aria-pressed={value === thisWeek}
        onClick={() => {
          if (value !== thisWeek) onChange(thisWeek)
        }}
      >
        <span className="week-switcher-label">This week</span>
        <span className="week-switcher-range">{formatWeekLabel(thisWeek)}</span>
      </button>
      <button
        type="button"
        className={
          value === nextWeek
            ? 'week-switcher-btn active'
            : 'week-switcher-btn'
        }
        disabled={disabled}
        aria-pressed={value === nextWeek}
        onClick={() => {
          if (value !== nextWeek) onChange(nextWeek)
        }}
      >
        <span className="week-switcher-label">Next week</span>
        <span className="week-switcher-range">{formatWeekLabel(nextWeek)}</span>
      </button>
    </div>
  )
}
