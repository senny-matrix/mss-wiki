import { eq } from "drizzle-orm";
import resend from "@/email";
import db from "@/src/db";
import { articles, usersSync } from "@/src/db/schema";
import CelebrationTemplate from "./templates/celebration-template";

const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : `http://localhost:3000`;

export default async function sendCelebrationEmail(
  articleId: number,
  pageViews: number,
) {
  const response = await db
    .select({
      email: usersSync.email,
      id: usersSync.id,
      title: articles.title,
      name: usersSync.name,
    })
    .from(articles)
    .leftJoin(usersSync, eq(articles.authorId, usersSync.id))
    .where(eq(articles.id, articleId));

  const { email, id, name, title } = response[0];

  if (!email) {
    console.log(
      `Skipping celebration for ${articleId} on pageviews ${pageViews}, could not find email in the database!`,
    );
    return;
  }

  // const emailRes = await resend.emails.send({
  //   from: "MSS Wiki <noreply@microskills.ac.tz>",
  //   to: email,
  //   subject: `Your article on MSS Wiki got ${pageViews} views`,
  //   html: `
  //   <h1>Congrats! </h1>
  //   <p>You are an amazing author and PEOPLE LIKE YOU</p>
  //   `,
  // });

  const emailRes = await resend.emails.send({
    from: "MSS Wiki <onboarding@resend.dev>",
    to: "arumeru@gmail.com",
    subject: `Your article on MSS Wiki got ${pageViews} views`,
    react: (
      <CelebrationTemplate
        articleTitle={title}
        articleUrl={`${BASE_URL}/wiki/${articleId}`}
        name={name ?? "Friend"}
        pageviews={pageViews}
      />
    ),
  });

  if (!emailRes.error) {
    console.log(
      `sent ${id} a celebration email for getting ${pageViews} on article ${articleId}`,
    );
  } else {
    console.log(
      `error seding  ${id} a celebration email for getting ${pageViews} on article ${articleId}`,
    );
  }
}
