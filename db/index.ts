import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  return drizzle(await getD1(), { schema });
}

export async function getD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as { DB?: D1Database };
  if (!runtimeEnv.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }
  return runtimeEnv.DB;
}
