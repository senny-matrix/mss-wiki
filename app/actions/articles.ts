"use server";

import { redirect } from "next/navigation";
import { hexclaveServerApp } from "@/hexclave/server";
import { eq } from "drizzle-orm";
import db from "@/src/db";
import { articles } from "@/src/db/schema";

export type CreateArticleInput = {
  title: string;
  content: string;
  authorId: string;
  imageUrl?: string;
};

export type UpdateArticleInput = {
  title?: string;
  content?: string;
  imageUrl?: string;
};

export async function createArticle(data: CreateArticleInput) {
  const user = await hexclaveServerApp.getUser();
  if (!user) {
    throw new Error("❌ - Unauthorized");
  }

  console.log("✨ createArticle called:", data);

  try {
    await db.insert(articles)
      .values({
        title: data.title,
        content: data.content,
        slug: `${Date.now()}`,
        published: true,
        authorId: user.id
      });
  } catch (e) {
    console.error("Failed to create article. The error was : ", e);
  }

    return { success: true, message: "Article create logged (stub)" };
}

export async function updateArticle(id: string, data: UpdateArticleInput) {
  const user = await hexclaveServerApp.getUser();
  if (!user) {
    throw new Error("❌ - Unauthorized");
  }

  const authorId = user.id;

  console.log("📝 updateArticle called:", { id, ...data });
  try {
    await db.update(articles)
      .set({
        title: data.title,
        content: data.content,
      }).where(eq(articles.id, +id))
  } catch (e) {
    console.error("Failed to update. The error was :", e);
  }

    return { success: true, message: `Article ${id} update logged (stub)` };
}

export async function deleteArticle(id: string) {

  console.log("🗑️ deleteArticle called:", id);

  try {
    await db.delete(articles)
      .where(eq(articles.id, +id));
  } catch (e) {
    console.error("Failed to delete article. The error was : ", e);
  }
  return { success: true, message: `Article ${id} delete logged (stub)` };
}

// Form-friendly server action: accepts FormData from a client form and calls deleteArticle
export async function deleteArticleForm(formData: FormData): Promise<void> {
  const user = await hexclaveServerApp.getUser();
  if (!user) {
    throw new Error("❌ - Unauthorized");
  }

  const id = formData.get("id");
  if (!id) {
    throw new Error("Missing article id");
  }

  await deleteArticle(String(id));
  // After deleting, redirect the user back to the homepage.
  redirect("/");
}
