-- ApiKey: expiry and per-key webhook signing secret
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "webhookSecret" TEXT;

-- Shared rate-limit counters. Serverless instances share no memory, so the
-- window has to live in the database to mean anything.
CREATE TABLE IF NOT EXISTS "RateLimit" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- Security audit trail.
CREATE TABLE IF NOT EXISTS "SecurityEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "actorHash" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SecurityEvent_kind_createdAt_idx" ON "SecurityEvent"("kind", "createdAt");
CREATE INDEX IF NOT EXISTS "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- ---------------------------------------------------------------------------
-- Lock the tables away from Supabase's Data API.
--
-- Supabase exposes the `public` schema over PostgREST using the `anon` key,
-- which is public by design, and grants `anon`/`authenticated` full table
-- privileges by default. With row level security off that means anyone holding
-- the anon key could read every password hash and API key hash over HTTP.
-- This application never uses the Data API — it talks to Postgres directly as
-- its own role — so the correct fix is to take those grants away entirely and
-- deny by default.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN
  -- Not a Supabase database; there are no anon/authenticated roles to revoke.
  NULL;
END $$;

-- Row level security as defence in depth, so a grant that reappears later
-- still yields nothing. The application role is not the table owner and has no
-- BYPASSRLS, so it needs an explicit policy or every statement it runs would
-- silently match zero rows.
DO $$
DECLARE
  t text;
  app_role text := current_setting('clouda.app_role', true);
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    app_role := 'clouda_app';
  END IF;

  FOREACH t IN ARRAY ARRAY['User','Account','Session','VerificationToken','ApiKey',
                           'UsageLog','SearchCache','ResearchRun','Monitor','MonitorEvent',
                           'RateLimit','SecurityEvent'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
      EXECUTE format('DROP POLICY IF EXISTS clouda_app_all ON %I', t);
      EXECUTE format(
        'CREATE POLICY clouda_app_all ON %I FOR ALL TO %I USING (true) WITH CHECK (true)',
        t, app_role);
    END IF;
  END LOOP;
END $$;
