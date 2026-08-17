import { eq } from "drizzle-orm";
import db from "@/src/db";
import { articles } from "@/src/db/schema";

export const authorizeUserToEditArticle =
  async function authorizeUserToEditArticle(
    loggedInUserId: string,
    articleId: number,
  ) {
    const response = await db
      .select({
        authorId: articles.authorId,
      })
      .from(articles)
      .where(eq(articles.id, articleId));

    if (!response.length) {
      return false;
    }

    return response[0].authorId === loggedInUserId;
  };
