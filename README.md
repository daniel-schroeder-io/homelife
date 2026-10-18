# HomeLife

Household meal planning, groceries, and prep — Vite + React frontend hosted by a Bun server with SQLite.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Vite client (proxy `/api`) + Bun API/SQLite server |
| `bun run build` | Production client build into `dist/` |
| `bun run start` | Serve built app + API from Bun (`PORT`, default 3000) |

## Stack

- **Client:** React + Vite + TypeScript (PWA)
- **Server:** Bun (`Bun.serve`)
- **Database:** SQLite via `bun:sqlite` (`DATA_DIR/homelife.sqlite`, default `data/`)

## Railway

This repo includes a `Dockerfile` (Bun-friendly) and `.railway/railway.ts` (volume at `/data`, health check `/api/health`).

```bash
railway up -y          # create/link project and deploy
railway config plan    # preview IaC (volume + env)
railway config apply   # apply after review
```

Generate a public domain in the Railway dashboard (Networking → Generate Domain) if one is not created automatically.

See `.env.example` for runtime variables.
