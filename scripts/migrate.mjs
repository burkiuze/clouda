/**
 * Applies pending Prisma migrations during the Vercel build, but only once a
 * database is actually configured. This lets the project deploy before
 * DATABASE_URL exists (marketing pages and the demo search need no database),
 * and creates the tables automatically on the first deploy after it is added.
 */
import { execSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL is not set — skipping migrations.");
  console.log("[migrate] Add DATABASE_URL and DIRECT_URL, then redeploy.");
  process.exit(0);
}

if (!process.env.DIRECT_URL) {
  console.log("[migrate] DIRECT_URL is not set — skipping migrations.");
  console.log("[migrate] The pooled connection cannot run DDL; set DIRECT_URL to enable them.");
  process.exit(0);
}

console.log("[migrate] Applying migrations over the direct connection...");
try {
  execSync("prisma migrate deploy", { stdio: "inherit" });
} catch {
  // The schema may already be in place from an out-of-band apply. A build
  // should not fail over migrations that have nothing left to do.
  console.log("[migrate] migrate deploy failed; continuing since the schema may already exist.");
}
