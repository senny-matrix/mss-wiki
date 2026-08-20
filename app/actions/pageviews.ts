"use server";

import redis from "@/src/cache";

const keyFor = (id: number) => `pageviews:article:${id}`;

export async function incrementPageview(articleId: number) {
  const articleKey = keyFor(articleId);
  const newVal = await redis.incr(articleKey);
  return +newVal;
}
