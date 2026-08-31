/**
 * Applies pending Prisma migrations during the Vercel build, but only once a
 * database is actually configured. This lets the project deploy before
 * DATABASE_URL exists (marketing pages and the demo search need no database),
 * and creates the tables automatically on the first deploy after it is added.
 */
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL is not set — skipping migrations.");
  console.log("[migrate] Add a Postgres database in Vercel, then redeploy.");
  process.exit(0);
}

console.log("[migrate] DATABASE_URL found — applying migrations...");
execSync("prisma migrate deploy", { stdio: "inherit" });
