import { eq } from "drizzle-orm";
import { hexclaveServerApp } from "@/hexclave/server";
import db from "@/src/db/index";
import { articles } from "@/src/db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAuthorName(authorId: string): Promise<string | null> {
  // Hexclave user ids are UUIDs. Anything else (e.g. the seed placeholder) has
  // no corresponding user, so skip the lookup instead of erroring.
  if (!UUID_RE.test(authorId)) return null;

  try {
    const user = await hexclaveServerApp.getUser(authorId);
    return user?.displayName ?? null;
  } catch {
    return null;
  }
}

export async function getArticles() {
  const rows = await db
    .select({
      title: articles.title,
      id: articles.id,
      createdAt: articles.createdAt,
      content: articles.content,
      authorId: articles.authorId,
    })
    .from(articles);

  const names = new Map<string, string | null>();
  await Promise.all(
    [...new Set(rows.map((row) => row.authorId))].map(async (authorId) => {
      names.set(authorId, await resolveAuthorName(authorId));
    }),
  );

  return rows.map((row) => ({
    title: row.title,
    id: row.id,
    createdAt: row.createdAt,
    content: row.content,
    author: names.get(row.authorId) ?? null,
  }));
}

export async function getArticleById(id: number) {
  const rows = await db
    .select({
      title: articles.title,
      id: articles.id,
      createdAt: articles.createdAt,
      content: articles.content,
      authorId: articles.authorId,
      imageUrl: articles.imageUrl,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);

  const article = rows[0];
  if (!article) return null;

  return {
    title: article.title,
    id: article.id,
    createdAt: article.createdAt,
    content: article.content,
    imageUrl: article.imageUrl,
    author: await resolveAuthorName(article.authorId),
  };
}
