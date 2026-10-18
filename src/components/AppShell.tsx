import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const navItems = [
  {
    to: '/tonight',
    label: 'Tonight',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="shell-nav-icon">
        <path
          fill="currentColor"
          d="M12 3.5a1 1 0 0 1 1 1V6a1 1 0 1 1-2 0V4.5a1 1 0 0 1 1-1Zm0 12.25a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Zm7.5-3.75a1 1 0 0 1-1 1H17a1 1 0 1 1 0-2h1.5a1 1 0 0 1 1 1ZM7 12a1 1 0 0 1-1 1H4.5a1 1 0 1 1 0-2H6a1 1 0 0 1 1 1Zm9.95 5.45a1 1 0 0 1 0 1.41l-1.06 1.06a1 1 0 1 1-1.41-1.41l1.06-1.06a1 1 0 0 1 1.41 0ZM9.52 6.08a1 1 0 0 1 0 1.41L8.46 8.55A1 1 0 0 1 7.05 7.14l1.06-1.06a1 1 0 0 1 1.41 0Zm8.43 0a1 1 0 0 1 1.41 0l1.06 1.06a1 1 0 1 1-1.41 1.41L17.95 7.5a1 1 0 0 1 0-1.41ZM8.46 15.45a1 1 0 0 1 1.41 1.41L8.81 17.92a1 1 0 1 1-1.41-1.41l1.06-1.06Z"
        />
      </svg>
    ),
  },
  {
    to: '/plan',
    label: 'Plan',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="shell-nav-icon">
        <path
          fill="currentColor"
          d="M7.5 3a1 1 0 0 1 1 1v1h7V4a1 1 0 1 1 2 0v1H19a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1.5V4a1 1 0 0 1 1-1ZM5 10v10h14V10H5Zm2.5 2.5h4v2h-4v-2Zm6 0h4v2h-4v-2Zm-6 4h4v2h-4v-2Zm6 0h4v2h-4v-2Z"
        />
      </svg>
    ),
  },
  {
    to: '/groceries',
    label: 'Shop',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="shell-nav-icon">
        <path
          fill="currentColor"
          d="M7 4a1 1 0 0 1 1-1h8a1 1 0 0 1 .96.73l1.5 5.27H21a1 1 0 1 1 0 2h-.28l-1.12 6.17A2.5 2.5 0 0 1 17.13 19H9.87a2.5 2.5 0 0 1-2.47-2.1L6.28 11H6a1 1 0 1 1 0-2h1.04L8.5 4.73A1 1 0 0 1 9.5 4H8a1 1 0 0 1-1-1Zm2.58 6h7.84l-.86 4.75a.5.5 0 0 1-.49.42H9.87a.5.5 0 0 1-.49-.42L8.58 10Zm1.17 10.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm6.5 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
        />
      </svg>
    ),
  },
  {
    to: '/recipes',
    label: 'Recipes',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="shell-nav-icon">
        <path
          fill="currentColor"
          d="M6.5 3A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21H18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H6.5ZM6 5.5A.5.5 0 0 1 6.5 5H8v14H6.5a.5.5 0 0 1-.5-.5v-13ZM10 5h8v14h-8V5Zm1.5 2.25h5v1.5h-5v-1.5Zm0 3h5v1.5h-5v-1.5Zm0 3h3.5v1.5H11.5v-1.5Z"
        />
      </svg>
    ),
  },
  {
    to: '/prep',
    label: 'Prep',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="shell-nav-icon">
        <path
          fill="currentColor"
          d="M9 3a1 1 0 0 1 1 1v1h4V4a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 20 7.5v11A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5H8V4a1 1 0 0 1 1-1Zm-2.5 4A.5.5 0 0 0 6 7.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-11ZM8 10.25h8v1.5H8v-1.5Zm0 3.5h8v1.5H8v-1.5Zm0 3.5h5v1.5H8v-1.5Z"
        />
      </svg>
    ),
  },
] as const

export function AppShell() {
  const { household, logout } = useAuth()
  const brand = household?.name ?? 'HomeLife'
  const location = useLocation()
  const cookMode = /\/recipes\/[^/]+\/cook\/?$/.test(location.pathname)

  return (
    <div className={cookMode ? 'shell shell-cook' : 'shell'}>
      {!cookMode ? (
        <header className="shell-header">
          <p className="shell-brand">{brand}</p>
          <div className="shell-header-actions">
            <nav className="shell-nav shell-nav-desktop" aria-label="Main">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? 'shell-nav-link active' : 'shell-nav-link'
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                isActive
                  ? 'shell-nav-link shell-settings active'
                  : 'shell-nav-link shell-settings'
              }
              title="Settings"
              aria-label="Settings"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="shell-settings-icon"
              >
                <path
                  fill="currentColor"
                  d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm8.05 2.7-1.08-.18a6.9 6.9 0 0 0-.66-1.6l.7-.84a.9.9 0 0 0-.08-1.2l-1.41-1.41a.9.9 0 0 0-1.2-.08l-.84.7a6.9 6.9 0 0 0-1.6-.66l-.18-1.08A.9.9 0 0 0 12.8 3h-1.6a.9.9 0 0 0-.89.75l-.18 1.08a6.9 6.9 0 0 0-1.6.66l-.84-.7a.9.9 0 0 0-1.2.08L5.08 6.28a.9.9 0 0 0-.08 1.2l.7.84a6.9 6.9 0 0 0-.66 1.6l-1.08.18A.9.9 0 0 0 3 12.2v1.6c0 .44.32.82.75.89l1.08.18c.14.57.36 1.11.66 1.6l-.7.84a.9.9 0 0 0 .08 1.2l1.41 1.41a.9.9 0 0 0 1.2.08l.84-.7c.49.3 1.03.52 1.6.66l.18 1.08c.07.43.45.75.89.75h1.6a.9.9 0 0 0 .89-.75l.18-1.08a6.9 6.9 0 0 0 1.6-.66l.84.7a.9.9 0 0 0 1.2-.08l1.41-1.41a.9.9 0 0 0 .08-1.2l-.7-.84c.3-.49.52-1.03.66-1.6l1.08-.18A.9.9 0 0 0 21 13.8v-1.6a.9.9 0 0 0-.95-.8Z"
                />
              </svg>
              <span className="shell-settings-label">Settings</span>
            </NavLink>
            <button
              type="button"
              className="btn btn-ghost btn-sm shell-logout"
              onClick={() => void logout()}
            >
              Sign out
            </button>
          </div>
        </header>
      ) : null}

      <div className="shell-main">
        <Outlet />
      </div>

      {!cookMode ? (
        <nav className="shell-nav shell-nav-mobile" aria-label="Main">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'shell-nav-link active' : 'shell-nav-link'
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      ) : null}
    </div>
  )
}
