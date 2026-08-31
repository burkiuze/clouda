-- ApiKey: per-key capabilities, limits and domain policy
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "rateLimitPerMin" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "creditCap" INTEGER;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "creditsSpent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "allowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "blockedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- UsageLog: observability fields
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "operation" TEXT NOT NULL DEFAULT 'search';
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "latencyMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "cacheHit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "steps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "success" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UsageLog" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;

CREATE INDEX IF NOT EXISTS "UsageLog_apiKeyId_createdAt_idx" ON "UsageLog"("apiKeyId", "createdAt");
CREATE INDEX IF NOT EXISTS "UsageLog_createdAt_idx" ON "UsageLog"("createdAt");

-- SearchCache
CREATE TABLE IF NOT EXISTS "SearchCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "freshnessH" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SearchCache_cacheKey_key" ON "SearchCache"("cacheKey");
CREATE INDEX IF NOT EXISTS "SearchCache_expiresAt_idx" ON "SearchCache"("expiresAt");

-- ResearchRun
CREATE TABLE IF NOT EXISTS "ResearchRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "depth" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'running',
    "report" JSONB,
    "sourcesCount" INTEGER NOT NULL DEFAULT 0,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ResearchRun_userId_idx" ON "ResearchRun"("userId");
CREATE INDEX IF NOT EXISTS "ResearchRun_apiKeyId_idx" ON "ResearchRun"("apiKeyId");

-- Monitor
CREATE TABLE IF NOT EXISTS "Monitor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastHash" TEXT,
    "lastSnapshot" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Monitor_userId_idx" ON "Monitor"("userId");
CREATE INDEX IF NOT EXISTS "Monitor_active_lastCheckedAt_idx" ON "Monitor"("active", "lastCheckedAt");

-- MonitorEvent
CREATE TABLE IF NOT EXISTS "MonitorEvent" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MonitorEvent_monitorId_idx" ON "MonitorEvent"("monitorId");

-- Foreign keys (added only when absent so re-runs stay safe)
DO $$ BEGIN
  ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MonitorEvent" ADD CONSTRAINT "MonitorEvent_monitorId_fkey"
    FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
