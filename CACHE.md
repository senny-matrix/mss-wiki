# Caching with Upstash Redis — Tutorial

> **What we did in lesson `14-upstash_redis`:** added a Redis cache in front of our
> database so the wiki homepage stops hammering Postgres on every request, and
> learned (the hard way) how to use the Upstash Redis client correctly.
>
> This document is written as a step-by-step tutorial so you can follow along and
> reproduce the work yourself. It includes the full story — including the bug we
> hit, *and* the sneaky follow-up bug where the cache kept serving garbage even
> after the code was fixed.

---

## Table of Contents

1. [Why do we need a cache?](#1-why-do-we-need-a-cache)
2. [What is Upstash Redis?](#2-what-is-upstash-redis)
3. [Setup — install & configure](#3-setup--install--configure)
4. [Create the Redis client](#4-create-the-redis-client)
5. [The cache read pattern (get → hit/miss → set)](#5-the-cache-read-pattern)
6. [The bug we hit (and what the error meant)](#6-the-bug-we-hit)
7. [The fix](#7-the-fix)
8. [We fixed the code — so why was it STILL broken?!](#8-we-fixed-the-code--so-why-was-it-still-broken)
9. [Cache invalidation — keep the cache honest](#9-cache-invalidation)
10. [The final code](#10-the-final-code)
11. [How to verify it works](#11-how-to-verify-it-works)
12. [Things to try on your own](#12-things-to-try-on-your-own)

---

## 1. Why do we need a cache?

Every time someone opens the homepage, our app runs a query against Postgres:

```ts
const rows = await db
  .select({ title: articles.title, id: articles.id, ... })
  .from(articles)
  .leftJoin(usersSync, eq(articles.authorId, usersSync.id));
```

If 1,000 people visit the homepage in a minute, that's **1,000 identical
queries** — the database does the same work over and over. That's slow, and it
costs money on a hosted database like Neon (you pay per query / per compute
time).

**The idea of a cache:** store the *result* of an expensive query somewhere
fast. The next time someone asks for the same data, serve it from the cache
instead of running the query again.

```
Before:  Browser ──▶ Next.js ──▶ Postgres (every time!)
After:   Browser ──▶ Next.js ──▶ [Redis] ──hit──▶ 🎯 fast answer
                          └──── miss ──▶ Postgres ──▶ store in Redis ──┐
                                                                    ▲
```

---

## 2. What is Upstash Redis?

[Upstash](https://upstash.com) is a serverless Redis provider. Redis is an
in-memory key-value store — the perfect place to put data that:

- is **read often** (like the article list),
- **changes rarely** (like a wiki article),
- and can **expire** after some time (TTL).

Upstash's free tier is enough for this project. The cool part for us is that
Upstash talks over plain **HTTPS (REST)** — you don't need to run a Redis server
locally, you just call a URL.

---

## 3. Setup — install & configure

### 3.1 Install the client

```bash
bun add @upstash/redis
```

### 3.2 Add credentials to `.env`

Create a database in the Upstash console, then add its URL and token:

```env
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-super-secret-token
```

> ⚠️ **Never commit `.env`** — it's already in `.gitignore`. If you want to
> verify, run `git status` and confirm `.env` doesn't appear as a new file.

---

## 4. Create the Redis client

We make a single shared client so every file uses the same connection. We put it
at `src/cache/index.ts`:

```ts
// src/cache/index.ts
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default redis;
```

Now any file can do `import redis from "@/src/cache";` and use it.

---

## 5. The cache read pattern

Every cached read follows the same **3-step pattern**. Learn this — you'll use
it everywhere:

```ts
// 1. TRY the cache
const cached = await redis.get("articles:all");

// 2. HIT? → return it, done
if (cached) {
  return cached;
}

// 3. MISS? → go to the real source (DB), then store it for next time
const rows = await db.select(...)...;
await redis.set("articles:all", rows, { ex: 60 }); // 60s TTL
return rows;
```

We can summarise the pattern as:

> **"Try the cache → hit means return early → miss means query + store."**

Note the **TTL** (`ex: 60`): even if nobody invalidates the cache, it will
self-destruct after 60 seconds and re-query. This is a safety net against stale
data.

> 💡 **Why `ex: 60` instead of infinite?** Because we don't want the homepage to
> show an article that was deleted 10 minutes ago. A short TTL guarantees
> freshness *eventually*, even if a bug prevents manual invalidation.

---

## 6. The bug we hit

We *thought* we wrote step 3 correctly, but look at this line:

```ts
// ❌ WHAT WE WROTE (wrong!)
redis.set("articles:all", {
  ex: 60,
});
```

Can you spot it? **We passed `{ ex: 60 }` as the *value* instead of as an
*option*.**

- The *value* should be the **articles array** (`rows`).
- The *options* (`{ ex: 60 }`) are the **third argument**.

The correct signature of `redis.set` is:

```ts
redis.set(key, value, options);
```

So our mistake stored the literal object `{ ex: 60 }` as the cached "articles".

### What the output looked like

```
🏹 Get Articles Cache Miss!!      ← first load, cache empty, queried the DB
🎯 Get Articles Cache Hit!        ← second load, cache has {ex:60} → returned it
⨯ TypeError: articles.map is not a function
    at Home (app/page.tsx:33:20)
```

**Reading these logs:**
- `Cache Miss` = cache was empty, we went to the DB. Fine.
- `Cache Hit` = we found *something* in Redis. But that something was the object
  `{ ex: 60 }`, not an array.
- `articles.map is not a function` = you can't call `.map()` on an object that
  isn't an array.

### There were actually 3 bugs

1. **`redis.set` had the wrong signature** — the value was `{ ex: 60 }` and the
   TTL option was never applied.
2. **The DB query was never awaited** — `db.select(...)...` returns a *query
   builder*, not the result. You must `await` it:
   ```ts
   // ❌ const resposne = db.select(...)   ← query builder, not rows!
   // ✅ const rows = await db.select(...) ← actual rows
   ```
3. **The return value was wrong** — we returned the unawaited query builder
   instead of the rows.

> 🧠 **Lesson:** a "cache hit" doesn't mean the data is *correct* — it means
> *something* was in the cache. Garbage in the cache is worse than no cache,
> because it silently serves wrong data.

---

## 7. The fix

```ts
export async function getArticles() {
  const cached = await redis.get("articles:all");
  if (cached) {
    console.log("🎯 Get Articles Cache Hit!");
    return cached;
  }

  console.log("🏹 Get Articles Cache Miss!!");
  const rows = await db
    .select({
      title: articles.title,
      id: articles.id,
      createdAt: articles.createdAt,
      content: articles.content,
      author: usersSync.name,
    })
    .from(articles)
    .leftJoin(usersSync, eq(articles.authorId, usersSync.id));

  await redis.set("articles:all", rows, { ex: 60 });

  return rows;
}
```

The three changes:

| # | Before (❌) | After (✅) |
|---|-------------|------------|
| 1 | `redis.set("articles:all", { ex: 60 })` | `redis.set("articles:all", rows, { ex: 60 })` |
| 2 | `const resposne = db.select(...)` | `const rows = await db.select(...)` |
| 3 | `return resposne;` | `return rows;` |

> 💡 Notice we did **not** need to serialize the array to JSON. The Upstash REST
> client auto-serializes values on `set` and auto-deserializes them on `get`.
> That's why a `Cache Hit` can return a real JavaScript array.

---

## 8. We fixed the code — so why was it STILL broken?!

We applied the fix, restarted the server… and the **exact same error** came back:

```
🎯 Get Articles Cache Hit!
⨯ TypeError: articles.map is not a function
```

The code was fixed, so what was going on?!

### The dirty little secret of caches

Remember how the buggy code stored the value?

```ts
redis.set("articles:all", { ex: 60 }); // ❌ {ex:60} became the VALUE
```

Because the TTL was never actually applied, that garbage entry was written to
Redis **with no expiration date**. And here's the critical part:

> **The cache lives in the cloud (Upstash), not in your process.**

When you restart `bun dev`, your code reloads fresh — but the **data** inside
Redis survives. Restarting the server does NOT restart the cache. The corrupt
`{"ex":60}` object was still sitting in Upstash Redis, waiting to be served as
"the articles list" on every single cache hit.

**Fixing the code fixes future writes. It does not fix data that was already
written.**

### Diagnose: look at what's actually in the cache

We wrote a tiny one-off script to inspect the raw value in Redis:

```ts
// clear-cache.ts (a temporary script)
import "dotenv/config";
import redis from "./src/cache/index.ts";

const value = await redis.get("articles:all");
console.log("BEFORE ->", JSON.stringify(value)); // {"ex":60} ← garbage!
```

Output confirmed our suspicion:

```
BEFORE delete -> {"ex":60}
```

That `{"ex":60}` is not an array of articles. No wonder `.map()` exploded.

### Fix: delete the stale key

```ts
const result = await redis.del("articles:all");
console.log("DEL result ->", result); // 1 = key deleted
console.log("AFTER  ->", await redis.get("articles:all")); // null
```

```
DEL result -> 1
AFTER  -> null
```

Once the key was gone, the next request was a genuine `Cache Miss` and the
homepage rendered properly again.

### The takeaways

1. **A code fix is not a cache fix.** The cache holds *data*, and that data can
   outlive the code that wrote it. When you deploy a fix that changes what gets
   cached, always clear the affected keys (or wait out their TTL).
2. **This is exactly why TTLs matter.** If the buggy write had included a short
   TTL — correctly, as an *option* — the garbage would have self-destructed
   within a minute and we never would have seen this. The TTL is your safety net
   when the manual invalidation path is broken.
3. **The Upstash console is your friend.** You can also inspect and delete keys
   directly from the Upstash dashboard — useful when a key is in a weird state.

---

## 9. Cache invalidation

The TTL is a safety net, but 60 seconds of stale data is still stale. When a
user **creates, edits, or deletes** an article, the cached list is now wrong.

**Invalidation** = deleting the cached value after a mutation, so the *next*
read is forced to re-query the DB.

### 9.1 The helper

We add a small helper next to the cache logic in `lib/data/articles.ts`:

```ts
export const ARTICLES_CACHE_KEY = "articles:all";

/**
 * Drop the cached articles list so the next read re-queries the DB.
 * Call this after any mutation (create / update / delete).
 */
export async function invalidateArticlesCache() {
  await redis.del(ARTICLES_CACHE_KEY);
}
```

Two nice touches:
- We **named the key** (`ARTICLES_CACHE_KEY`) so it's defined in exactly one
  place — no typos like `"articles:all"` vs `"articles:All"`.
- The helper centralizes *how* we invalidate, so callers don't touch `redis`
  directly.

### 9.2 Call it after every mutation

In `app/actions/articles.ts` (our server actions), after each database write:

```ts
// createArticle
await db.insert(articles).values({ ... });
await invalidateArticlesCache();   // ← NEW
return { success: true, id: inserted[0]?.id };

// updateArticle
await db.update(articles).set({ ... }).where(eq(articles.id, +id));
await invalidateArticlesCache();   // ← NEW
return { success: true, id: +id };

// deleteArticle
await db.delete(articles).where(eq(articles.id, +id));
await invalidateArticlesCache();   // ← NEW
return { success: true, ... };
```

**Why after and not before?** Because the mutation succeeded — we only want to
drop the cache when the database is guaranteed to be different. If the DB write
throws, we never invalidate, and the old (still valid) cache survives.

### The lifecycle now

```
READ:   get("articles:all") ──hit──▶ return cached
                          └─miss──▶ query DB ──▶ set(key, rows, {ex:60}) ──▶ return rows

WRITE:  DB mutation ──▶ del("articles:all")   ← next read is a MISS → fresh data
```

---

## 10. The final code

### `src/cache/index.ts`

```ts
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default redis;
```

### `lib/data/articles.ts`

```ts
import { eq } from "drizzle-orm";
import redis from "@/src/cache";
import db from "@/src/db/index";
import { articles, usersSync } from "@/src/db/schema";

export const ARTICLES_CACHE_KEY = "articles:all";

export async function invalidateArticlesCache() {
  await redis.del(ARTICLES_CACHE_KEY);
}

export async function getArticles() {
  const cached = await redis.get(ARTICLES_CACHE_KEY);
  if (cached) {
    console.log("🎯 Get Articles Cache Hit!");
    return cached;
  }

  console.log("🏹 Get Articles Cache Miss!!");
  const rows = await db
    .select({
      title: articles.title,
      id: articles.id,
      createdAt: articles.createdAt,
      content: articles.content,
      author: usersSync.name,
    })
    .from(articles)
    .leftJoin(usersSync, eq(articles.authorId, usersSync.id));

  await redis.set(ARTICLES_CACHE_KEY, rows, { ex: 60 });

  return rows;
}
```

### `app/actions/articles.ts` (excerpt — the important lines)

```ts
import { invalidateArticlesCache } from "@/lib/data/articles";

// createArticle → after db.insert(...)  → await invalidateArticlesCache();
// updateArticle → after db.update(...)  → await invalidateArticlesCache();
// deleteArticle → after db.delete(...)  → await invalidateArticlesCache();
```

---

## 11. How to verify it works

1. Start the dev server:
   ```bash
   bun dev
   ```
2. Open `http://localhost:3000` and watch the terminal.

**First load (cache empty):**
```
🏹 Get Articles Cache Miss!!
GET / 200 in 1935ms
```

**Second load (cache filled):**
```
🎯 Get Articles Cache Hit!
GET / 200 in 780ms
```

Notice the **big speedup**: ~1.9s → ~0.8s. The second request never touched the
database.

3. Now **edit or create an article**, then refresh the homepage. You should see
   a `Cache Miss` again — proof the invalidation dropped the stale entry and the
   fresh data was served.

### 🚨 If you still see the error after fixing the code

You've just hit Section 8. The stale key is still in the cloud. Delete it:

```bash
# one-off script using the project's redis client
cat > /tmp/clear-cache.ts <<'EOF'
import "dotenv/config";
import redis from "./src/cache/index.ts";

const before = await redis.get("articles:all");
console.log("BEFORE ->", JSON.stringify(before));

const result = await redis.del("articles:all");
console.log("DEL result ->", result);

const after = await redis.get("articles:all");
console.log("AFTER  ->", after);
EOF
bun run /tmp/clear-cache.ts
```

Expected output:

```
BEFORE -> {"ex":60}     ← the garbage from the old bug
DEL result -> 1         ← key deleted
AFTER  -> null          ← confirmed gone
```

Then hard-refresh the browser (`Cmd+Shift+R`) and you should see a genuine
`Cache Miss` followed by a working page.

---

## 12. Things to try on your own

These are good stretch exercises — ask yourself the questions before reading the
hints.

1. **Cache the single-article page too.**
   `getArticleById(id)` currently queries the DB every time. Cache it under a
   per-article key like `article:${id}` with the same pattern. *(Hint: your
   invalidation helper should now delete both `articles:all` **and**
   `article:${id}`.)*

2. **TTL vs invalidation — which is "source of truth"?**
   If you cache a single article for 10 minutes but the user edits it, the page
   shows stale content for 10 minutes. How would you fix that? *(Hint: you
   already have the tool — `redis.del`.)*

3. **What happens to the cache when the DB is empty?**
   Our `if (cached)` check treats an empty array as *falsy*... wait, actually it
   doesn't — an empty array `[]` is truthy in JavaScript! So an empty result
   *will* be cached. Is that what we want? When would that be a problem?

4. **Cache stampede (bonus).**
   If 100 people hit the page the same millisecond the cache expires, all 100
   will query the DB. How could you make only *one* of them query, and the rest
   wait for the result? *(Hint: search for "single-flight" or "request
   coalescing".)*

5. **You deploy a fix, but the cache still serves the old broken value. Why?**
   *(Hint: this whole tutorial happened because of that — reread Section 8. What
   tool do you reach for to confirm what's actually in Redis?)*

---

*Lesson branch: `14-upstash_redis` · Repo: `senny-matrix/mss-wiki`*
