import { describe, expect, it, vi } from "vitest";
import { buildBriefingPrompt, generateBriefing, type BriefingContext } from "../src/briefing/service";

const context: BriefingContext = {
  scope: "Span",
  boundaryPoleId: "P-000021",
  affectedPoleCount: 4,
  pinCode: "472991",
  topologySource: "recorded",
  confidence: 1,
  corroboratedEvidence: "Contiguous power_lost telemetry beyond the boundary.",
  dtId: "DT-001",
  feederId: "F-001",
};

describe("incident briefing service", () => {
  it("returns an AI briefing when the provider succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: "Verify P-000021 and the four downstream assets. Crew PIN 472991." }],
    }), { status: 200 }));

    const result = await generateBriefing(context, { apiKey: "test-key", fetchImpl });

    expect(result).toEqual({
      source: "ai",
      briefing: "Verify P-000021 and the four downstream assets. Crew PIN 472991.",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(buildBriefingPrompt(context)).toContain("Do not infer, change, dispute, or add fault boundaries");
  });

  it("uses the deterministic fallback without an API key", async () => {
    const fetchImpl = vi.fn();

    const result = await generateBriefing(context, { apiKey: "", fetchImpl });

    expect(result.source).toBe("fallback");
    expect(result.briefing).toContain("SPAN FAULT BRIEFING");
    expect(result.briefing).toContain("Crew PIN: 472991");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the deterministic fallback when the provider request fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network unavailable"));

    const result = await generateBriefing(context, { apiKey: "test-key", fetchImpl });

    expect(result.source).toBe("fallback");
    expect(result.briefing).toContain("recorded topology, 100% confidence");
  });
});
