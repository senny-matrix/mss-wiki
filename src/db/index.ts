import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/src/db/schema";
import "dotenv/config";
import assert from "node:assert";

assert(process.env.DATABASE_URL, "You need DATABASE_URL");

export const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql, { schema });
export default db;
