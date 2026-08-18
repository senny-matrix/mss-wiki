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
      console.error("🔒 authZ: article not found", { articleId });
      return false;
    }

    const articleAuthorId = response[0].authorId;
    if (articleAuthorId !== loggedInUserId) {
      console.error("🔒 authZ: author mismatch", {
        loggedInUserId,
        articleAuthorId,
        articleId,
      });
    }
    return articleAuthorId === loggedInUserId;
  };
