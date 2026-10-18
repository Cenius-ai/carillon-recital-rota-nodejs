# Install and run — Carillon Recital Rota

The project is a single plain Node HTTP server with **no third-party
dependencies**, so installation is: check the runtime, create the data directory,
seed the demo rota.

## 1. Prerequisites

Install these on the machine yourself (the install script never touches system
packages):

- **Node.js 20** (18 or newer works). Check with `node --version`.
- A shell (`bash`/`sh`) and a writable copy of this directory.

No database, no package registry account and no network connection is needed at
runtime. There is no external service, CDN or font download.

## 2. Install

```bash
sh install.sh
```

The script:

1. verifies Node is on `PATH` and is 18+,
2. creates `data/` if it is missing,
3. runs `node seed.js`, which writes `data/db.json` with the demo carillonneurs,
   eight upcoming Sunday recitals, their programmes and eight practice slots.

It is **idempotent** — running it again never duplicates records — and it **exits
without starting the server**.

## 3. Seed (already done by step 2)

```bash
node seed.js        # or: npm run seed
```

Safe to re-run at any time. The server also seeds itself on boot when the store is
empty, so a fresh clone works even if you skip this step.

## 4. Run

```bash
node server.js
```

The server binds `0.0.0.0` and reads `PORT` from the environment, defaulting to
`3000` (`PORT=8080 node server.js` to change it). You should see:

```
[carillon-rota] data file: /…/data/db.json
[carillon-rota] listening on 0.0.0.0:3000
```

Open <http://localhost:3000> and sign in with the demo account:

| Email | Role | Password |
| --- | --- | --- |
| cenius@cenius.ai | Tower coordinator (full access) | cenius |

The sign-in card also shows these credentials and offers a **Use demo account**
button.

## 5. Test

```bash
npm test
```

Runs `node --test tests/` — 17 end-to-end API tests against a temporary data
directory. No network, no external services, no interactive prompts.

## Optional configuration

Copy `.env.example` to `.env` if you want to change the port or data directory:

```bash
cp .env.example .env
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Bind port on `0.0.0.0`. |
| `DATA_DIR` | `./data` | JSON store directory; created automatically. |

Environment variables already exported in the shell win over `.env`.

## Resetting the demo data

```bash
rm -rf data && node seed.js
```

The next boot recreates and re-seeds the store.

## Troubleshooting

- **`EADDRINUSE`** — another process holds the port. Use `PORT=3001 node server.js`.
- **`data/db.json` is not valid JSON** — the server logs the problem and starts from
  an empty store, then re-seeds. Nothing crashes.
- **Signed in but the rota looks empty** — the rota lists recitals dated today or
  later. Use the **Everything** filter on the rota screen to see the whole season.
- **Cookies not sticking** — the session cookie is `HttpOnly`/`SameSite=Lax` and is
  intentionally not `Secure`, so the app also works over plain HTTP on localhost.
