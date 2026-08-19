# HexClave Troubleshooting — "When HexClave misbehaves"

> **Lesson:** `14-upstash_redis` · **Topic:** what to do when the HexClave
> development dashboard refuses to start.
>
> This is the companion doc to `scripts/fix-hexclave-dashboard.sh`. Read this
> first to understand **why** the dashboard breaks, then run the script (or fix
> it by hand) to repair it.

---

## Table of Contents

1. [The symptom](#1-the-symptom)
2. [What is the HexClave dashboard?](#2-what-is-the-hexclave-dashboard)
3. [Root cause — a corrupted cache](#3-root-cause--a-corrupted-cache)
4. [The one-command fix](#4-the-one-command-fix)
5. [Fixing it by hand (for learning)](#5-fixing-it-by-hand-for-learning)
6. [How to prevent it](#6-how-to-prevent-it)
7. [Things to try on your own](#7-things-to-try-on-your-own)

---

## 1. The symptom

You run `bun dev` and instead of the usual smooth startup you see:

```
$ hexclave dev --config-file ./hexclave.config.ts -- bun run dev:inner
[Hexclave] Checking for Hexclave dashboard updates...
[Hexclave] ⠋ Hexclave dashboard not found on port 26700. Starting now
[Hexclave] ⠙ Hexclave dashboard not found on port 26700. Starting now
[Hexclave] ⠹ Hexclave dashboard not found on port 26700. Starting now
   ... (spins for a while) ...
Error: Timed out waiting for the development environment dashboard to start
at http://127.0.0.1:26700. Dashboard logs: .../rde-dashboard-26700.log
```

Then the process exits with code 1. Next.js never starts.

**If you look inside the dashboard log** (`cat ~/.stack/rde-dashboard-26700.log`),
you'll usually find the real culprit — something like:

```
Cannot find module
'.../rde-dashboard-runtime-26700/node_modules/@swc/helpers/esm/_interop_require_default.js'
```

That error is the key: a **corrupted or partial install** of the dashboard.

---

## 2. What is the HexClave dashboard?

When you run `bun dev`, the `hexclave` CLI actually does two jobs:

1. Starts a small **local dashboard server** on port `26700`
   (`http://127.0.0.1:26700`). This is the HexClave auth dashboard.
2. Then runs your app: `bun run dev:inner` → `next dev` on port 3000.

The dashboard is a **Node.js app itself**, and HexClave downloads & installs a
cached copy of it under `~/.stack/`. It works like this:

```
~/.stack/
├── dashboards/                    ← durable cached installs (versioned)
│   └── rde-dashboard-<version>/
│       ├── node_modules/
│       │   └── @swc/helpers/esm/_interop_require_default.js  ← can go missing
│       └── .hexclave-complete     ← "extraction finished" marker
├── rde-dashboard-runtime-26700/   ← throwaway copy used at runtime
├── rde-dashboard-runtime-26700.lock
├── rde-dashboard-26700.log        ← dashboard logs (read these first!)
└── dev-envs.json                  ← records which pid/secret owns port 26700
```

Every startup, the CLI copies the cached version into the runtime dir and
starts it. **If the cache is corrupted, the CLI keeps trying the same broken
copy** until its 60-second timeout, then gives up.

> 🧠 **Mental model:** HexClave's cache works just like the Redis cache we added
> in this lesson — a copy of something that *should* speed things up, but when
> it goes stale/corrupt it breaks you. **A fix in the source code does not fix
> a corrupted cache.** You have to evict the bad copy.

---

## 3. Root cause — a corrupted cache

The crash signature is a missing `@swc/helpers` ESM helper file:

```
_interop_require_default.js
_interop_require_wildcard.js
```

Why do these go missing? The dashboard install was **interrupted or partially
extracted** (e.g. a crashed machine, a killed process, a bad download). The
cache directory looks complete but is missing files. The CLI has no idea the
install is broken — it just sees a directory and tries to run it.

Two corruption signatures the fix script checks for:

| Signature | Meaning |
|---|---|
| Missing `.hexclave-complete` marker | Extraction never finished (partial install) |
| Missing `@swc/helpers/esm/_interop_require_*.js` | Known boot-crash file missing |

---

## 4. The one-command fix

We ship a repair script with the project:

```bash
bun scripts/fix-hexclave-dashboard.sh
# or:  ./scripts/fix-hexclave-dashboard.sh
```

Useful flags:

```bash
bun scripts/fix-hexclave-dashboard.sh --dry-run   # preview what it would delete
bun scripts/fix-hexclave-dashboard.sh --force     # skip the confirmation prompt
```

What the script does, in order:

1. **Checks health first** — if `http://127.0.0.1:26700` already answers `200`,
   it does nothing. The script is a no-op when the dashboard is fine.
2. **Stops stale processes** — kills the recorded dashboard pid from
   `dev-envs.json` and anything still listening on port 26700 (escalating to
   `SIGKILL` if needed).
3. **Removes the runtime copy** — deletes `rde-dashboard-runtime-26700/` (safe:
   the CLI rebuilds this throwaway copy on every start).
4. **Evicts corrupted caches** — scans `~/.stack/dashboards/*/`, and removes
   only the ones missing the `.hexclave-complete` marker or the
   `@swc/helpers` ESM files. Healthy caches are left alone.
5. **Clears stale state** — removes the dead dashboard's entry from
   `dev-envs.json` so the CLI starts a clean instance.
6. **Reports next steps** — you can now run `bun dev` again and the CLI will
   re-download a clean dashboard.

> 🔒 **Safety note:** the script only ever deletes things under `~/.stack` that
> belong to the local dashboard, and it verifies health before touching
> anything. It never touches your app code, database, or Redis cache.

---

## 5. Fixing it by hand (for learning)

If you want to understand *exactly* what the script does, this is the manual
version:

```bash
# 0. Read the log first — always diagnose before you delete!
cat ~/.stack/rde-dashboard-26700.log

# 1. Stop any dashboard process still running
lsof -tiTCP:26700 -sTCP:LISTEN | xargs kill

# 2. Remove the corrupted runtime copy (safe — it's rebuilt each start)
rm -rf ~/.stack/rde-dashboard-runtime-26700

# 3. Evict the corrupted cached install
#    (find the cache missing @swc/helpers and remove only that one)
rm -rf ~/.stack/dashboards/<corrupted-version>

# 4. Clear the stale port record so the CLI starts fresh
#    (edit ~/.stack/dev-envs.json and remove the "26700" entry)

# 5. Restart
bun dev
```

**Rule of thumb:** *diagnose (read the log) → kill the dead process → evict the
broken cache → start fresh.* The script automates exactly this sequence.

---

## 6. How to prevent it

- **Don't kill `bun dev` mid-startup** — if you `Ctrl+C` while the dashboard is
  still extracting, you can leave a partial cache behind.
- **If the machine crashes or sleeps mid-extract**, be suspicious of the
  dashboard cache before blaming your app code.
- **Check `~/.stack/rde-dashboard-26700.log` first** — the log tells you whether
  the failure is in the dashboard (cache/module errors) or in your app
  (TypeScript errors, port conflicts).
- **Keep the fix script committed** — that's why it lives in `scripts/` in the
  repo: anyone who clones the project gets the same repair tool.

---

## 7. Things to try on your own

1. Run the script with `--dry-run` while the dashboard is healthy. What does it
   print? (It should refuse to do anything.)
2. Simulate corruption: rename a `@swc/helpers` file inside a cached dashboard
   dir, run `bun dev`, watch it fail, then run the fix script and confirm it
   detects + repairs the cache.
3. Read `~/.stack/rde-dashboard-26700.log` and identify which part of the
   dashboard crashed before it failed to boot.
4. Explain why deleting `rde-dashboard-runtime-26700/` is always safe, but
   deleting a versioned cache dir under `dashboards/` requires checking for
   corruption first. (Hint: one is rebuilt every run, the other is the durable
   install.)
