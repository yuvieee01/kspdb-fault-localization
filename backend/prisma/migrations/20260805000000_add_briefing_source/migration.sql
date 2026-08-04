-- Persist the provenance of cached operational briefings so dispatchers can
-- distinguish an LLM response from the deterministic safety fallback.
CREATE TYPE "BriefingSource" AS ENUM ('ai', 'fallback');

ALTER TABLE "incidents"
ADD COLUMN "briefing_source" "BriefingSource";
