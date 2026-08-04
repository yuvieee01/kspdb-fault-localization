export type BriefingSource = "ai" | "fallback";

export interface BriefingContext {
  scope: "Span" | "DT" | "Feeder";
  boundaryPoleId: string | null;
  affectedPoleCount: number;
  pinCode: string;
  topologySource: "recorded" | "inferred" | "mixed" | "root-level";
  confidence: number;
  corroboratedEvidence: string;
  dtId: string | null;
  feederId: string;
}

export interface BriefingResult {
  briefing: string;
  source: BriefingSource;
}

type FetchImplementation = typeof fetch;

const DEFAULT_MODEL = "claude-3-5-haiku-latest";
const REQUEST_TIMEOUT_MS = 7_000;

function confidencePercent(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}

function locationLabel(context: BriefingContext): string {
  if (context.boundaryPoleId) return `Boundary at Pole ${context.boundaryPoleId}`;
  if (context.dtId) return `Root-level condition on DT ${context.dtId}`;
  return `Root-level condition on feeder ${context.feederId}`;
}

/**
 * Creates an auditable fixed-format briefing when an LLM is unavailable.
 * It deliberately uses only facts already produced by deterministic localization.
 */
export function buildFallbackBriefing(context: BriefingContext): string {
  return `${context.scope.toUpperCase()} FAULT BRIEFING: ${locationLabel(context)} affecting ${context.affectedPoleCount} pole${context.affectedPoleCount === 1 ? "" : "s"} on ${context.dtId ?? `feeder ${context.feederId}`}. Ground truth: ${context.topologySource} topology, ${confidencePercent(context.confidence)} confidence. Evidence: ${context.corroboratedEvidence}. Crew PIN: ${context.pinCode}.`;
}

/** The model receives facts only; it is explicitly prohibited from localization. */
export function buildBriefingPrompt(context: BriefingContext): string {
  return [
    "Prepare a concise operational briefing for dispatchers and a field crew.",
    "This incident was already localized by a deterministic graph algorithm.",
    "Do not infer, change, dispute, or add fault boundaries, affected assets, scope, or root cause.",
    "Do not provide electrical switching instructions. Summarize only the supplied facts and recommend verifying the listed boundary and affected assets.",
    "Return plain text of at most 120 words.",
    "",
    `Scope: ${context.scope}`,
    `Boundary: ${context.boundaryPoleId ?? "root-level condition"}`,
    `Affected asset count: ${context.affectedPoleCount}`,
    `Crew PIN: ${context.pinCode}`,
    `Topology source: ${context.topologySource}`,
    `Confidence: ${confidencePercent(context.confidence)}`,
    `Corroborated evidence: ${context.corroboratedEvidence}`,
    `DT: ${context.dtId ?? "not applicable"}`,
    `Feeder: ${context.feederId}`,
  ].join("\n");
}

function extractText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("content" in payload)) return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const textBlock = content.find(
    (block): block is { type: string; text: string } =>
      !!block && typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
  );
  const text = textBlock?.text.trim();
  return text || null;
}

/**
 * Generates a presentation-only briefing. Provider errors intentionally resolve
 * to the deterministic template so a dispatcher never sees an LLM error state.
 */
export async function generateBriefing(
  context: BriefingContext,
  options: { apiKey?: string; fetchImpl?: FetchImplementation; model?: string } = {}
): Promise<BriefingResult> {
  const fallback = (): BriefingResult => ({ briefing: buildFallbackBriefing(context), source: "fallback" });
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
        max_tokens: 280,
        messages: [{ role: "user", content: buildBriefingPrompt(context) }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return fallback();
    const text = extractText(await response.json());
    return text ? { briefing: text, source: "ai" } : fallback();
  } catch {
    return fallback();
  } finally {
    clearTimeout(timeout);
  }
}
