import { join } from 'node:path'
import { db, getMeta } from './db.ts'
import { handleAuthRoutes } from './routes/auth.ts'
import { handleCookHistoryRoutes } from './routes/cookHistory.ts'
import { handleGroceryRoutes } from './routes/groceries.ts'
import { handleHouseholdRoutes } from './routes/households.ts'
import { handlePantryRoutes } from './routes/pantry.ts'
import { handlePlanRoutes } from './routes/plans.ts'
import { handlePrepRoutes } from './routes/prep.ts'
import { handleRecipeRoutes } from './routes/recipes.ts'

const PORT = Number(process.env.PORT ?? 3000)
const DIST = join(import.meta.dir, '..', 'dist')
const isProd = process.env.NODE_ENV === 'production'

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/api/health') {
      try {
        db.query('SELECT 1').get()
        return Response.json({
          ok: true,
          name: getMeta('name'),
          db: 'connected',
        })
      } catch (error) {
        return Response.json(
          {
            ok: false,
            db: 'error',
            message: error instanceof Error ? error.message : 'unknown',
          },
          { status: 500 },
        )
      }
    }

    if (path === '/api/welcome') {
      return Response.json({
        name: getMeta('name') ?? 'HomeLife',
        message: getMeta('welcome') ?? 'Welcome to HomeLife',
      })
    }

    if (path.startsWith('/api/')) {
      try {
        const authRes = await handleAuthRoutes(req, path)
        if (authRes) return authRes

        const householdRes = await handleHouseholdRoutes(req, path)
        if (householdRes) return householdRes

        const recipeRes = await handleRecipeRoutes(req, path)
        if (recipeRes) return recipeRes

        const planRes = await handlePlanRoutes(req, path)
        if (planRes) return planRes

        const groceryRes = await handleGroceryRoutes(req, path)
        if (groceryRes) return groceryRes

        const pantryRes = await handlePantryRoutes(req, path)
        if (pantryRes) return pantryRes

        const cookHistoryRes = await handleCookHistoryRoutes(req, path)
        if (cookHistoryRes) return cookHistoryRes

        const prepRes = await handlePrepRoutes(req, path)
        if (prepRes) return prepRes

        return Response.json({ error: 'Not found' }, { status: 404 })
      } catch (error) {
        console.error('API error:', error)
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : 'Internal server error',
          },
          { status: 500 },
        )
      }
    }

    if (isProd) {
      const filePath =
        path === '/' ? join(DIST, 'index.html') : join(DIST, path)
      const file = Bun.file(filePath)

      if (await file.exists()) {
        const headers = new Headers()
        if (path.endsWith('.webmanifest')) {
          headers.set('Content-Type', 'application/manifest+json')
        } else if (path === '/sw.js' || /\/workbox-.*\.js$/.test(path)) {
          headers.set('Content-Type', 'application/javascript; charset=utf-8')
          headers.set('Service-Worker-Allowed', '/')
          headers.set('Cache-Control', 'no-cache')
        }
        return new Response(file, { headers })
      }

      const fallback = Bun.file(join(DIST, 'index.html'))
      if (await fallback.exists()) {
        return new Response(fallback)
      }
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`HomeLife server listening on http://localhost:${server.port}`)
console.log(`SQLite: connected (${isProd ? 'production' : 'development'})`)
