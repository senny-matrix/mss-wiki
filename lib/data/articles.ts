import { eq } from "drizzle-orm";
import redis from "@/src/cache";
import db from "@/src/db/index";
import { articles, usersSync } from "@/src/db/schema";

export const ARTICLES_CACHE_KEY = "articles:all";

/**
 * Drop the cached articles list so the next read re-queries the DB.
 * Call this after any mutation (create / update / delete).
 */
export async function invalidateArticlesCache() {
  await redis.del(ARTICLES_CACHE_KEY);
}

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

export async function getArticleById(id: number) {
  const rows = await db
    .select({
      title: articles.title,
      id: articles.id,
      createdAt: articles.createdAt,
      content: articles.content,
      author: usersSync.name,
      imageUrl: articles.imageUrl,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .leftJoin(usersSync, eq(articles.authorId, usersSync.id))
    .limit(1);

  return rows[0] ?? null;
}
