"use server";

import sendCelebrationEmail from "@/email/celebration-email";
import redis from "@/src/cache";

const mileStones = [10, 50, 100, 10000];

const keyFor = (id: number) => `pageviews:article:${id}`;

export async function incrementPageview(articleId: number) {
  const articleKey = keyFor(articleId);
  const newVal = await redis.incr(articleKey);

  if (mileStones.includes(newVal)) {
    sendCelebrationEmail(articleId, newVal);
  }
  return +newVal;
}
