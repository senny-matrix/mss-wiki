import { eq } from "drizzle-orm";
import db from "@/src/db/index";
import { articles, usersSync } from "@/src/db/schema";

export async function getArticles() {
  return db
    .select({
      title: articles.title,
      id: articles.id,
      createdAt: articles.createdAt,
      content: articles.content,
      author: usersSync.name,
    })
    .from(articles)
    .leftJoin(usersSync, eq(articles.authorId, usersSync.id));
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
