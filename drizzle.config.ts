import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./src/db/url";

config({ path: ".env.local" });

const { url, from } = resolveDatabaseUrl();
console.log(`drizzle: using connection string from ${from}`);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
