import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RequireAuth'
import { AuthProvider } from './lib/auth'
import { Cook } from './pages/Cook'
import { Groceries } from './pages/Groceries'
import { HouseholdOnboarding } from './pages/HouseholdOnboarding'
import { Login } from './pages/Login'
import { Pantry } from './pages/Pantry'
import { Plan } from './pages/Plan'
import { Prep } from './pages/Prep'
import { RecipeDetail } from './pages/RecipeDetail'
import { RecipeNew } from './pages/RecipeNew'
import { Recipes } from './pages/Recipes'
import { Register } from './pages/Register'
import { Settings } from './pages/Settings'
import { Tonight } from './pages/Tonight'
import './App.css'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/household" element={<HouseholdOnboarding />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/tonight" replace />} />
              <Route path="tonight" element={<Tonight />} />
              <Route path="plan" element={<Plan />} />
              <Route path="groceries" element={<Groceries />} />
              <Route path="pantry" element={<Pantry />} />
              <Route path="recipes" element={<Recipes />} />
              <Route
                path="recipes/new"
                element={<RecipeNew mode="manual" />}
              />
              <Route
                path="recipes/import"
                element={<RecipeNew mode="import" />}
              />
              <Route path="recipes/:id" element={<RecipeDetail />} />
              <Route path="recipes/:id/cook" element={<Cook />} />
              <Route path="prep" element={<Prep />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/tonight" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
