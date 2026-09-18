import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./url";

// HTTP driver: one fetch per query, no connection to hold open, which suits serverless functions.
export const db = drizzle(neon(resolveDatabaseUrl().url), { schema });
export { schema };
