import OpenAI from "openai";
import { config } from "./config";
import type { TestCase } from "./dataset";

// ---------------------------------------------------------------------------
// LLM-as-judge scoring functions
//
// Each scorer issues a separate GPT-4o call with a structured rubric.
// Chain-of-thought reasoning is elicited but only the numeric score is parsed.
//
// Design notes:
// - Scores are 0.0–1.0 (float, not discrete buckets) to preserve signal
// - Prompts include explicit anchors at 0, 0.5, and 1.0 to reduce judge drift
// - We avoid asking for multiple dimensions in one call to prevent anchoring
// - Temperature is kept low (0.1) to reduce judge variance across runs
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

/**
 * Call the judge model and parse a float score from its response.
 *
 * Parsing strategy (in order):
 *   1. Look for the canonical "SCORE: 0.85" line the prompt requests.
 *   2. Fallback: scan the full response for any bare decimal in [0, 1].
 *   3. If still nothing, default to 0.5 and log the failure with context.
 *
 * @param context - "caseId/scorerName" label used in fallback log messages.
 */
async function callJudge(
  systemPrompt: string,
  userPrompt: string,
  context: string
): Promise<number> {
  const client = getOpenAIClient();

  const completion = await client.chat.completions.create({
    model: config.judgingModel,
    max_tokens: config.judging.maxTokens,
    temperature: config.judging.temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = completion.choices[0]?.message.content ?? "";

  // Primary: parse the canonical SCORE: line
  const primaryMatch = raw.match(/SCORE:\s*([\d.]+)/i);
  if (primaryMatch) {
    const score = parseFloat(primaryMatch[1]);
    if (!isNaN(score) && score >= 0 && score <= 1) {
      return score;
    }
  }

  // Fallback: extract any decimal between 0 and 1 from the response.
  // Matches values like "0.75", "0.8", "1.0" but not integers like "1" alone
  // (too ambiguous — could be a list marker, a year fragment, etc.).
  const candidates = [...raw.matchAll(/\b(0\.\d+|1\.0+)\b/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 1);

  if (candidates.length > 0) {
    // Prefer the last candidate — judges typically conclude with their score
    const score = candidates[candidates.length - 1];
    console.warn(
      `  [judge] ${context}: no SCORE: line found — using fallback value ${score.toFixed(2)} extracted from response`
    );
    return score;
  }

  // Nothing parseable — default to neutral 0.5 rather than crashing
  console.warn(
    `  [judge] ${context}: could not parse any score from response — defaulting to 0.5\n` +
      `  Response was: ${raw.slice(0, 200)}${raw.length > 200 ? "…" : ""}`
  );
  return 0.5;
}

// ---------------------------------------------------------------------------
// Scorer 1: Relevance
// Does the response actually address the customer's specific issue?
// ---------------------------------------------------------------------------

const RELEVANCE_SYSTEM = `You are an expert evaluator for customer support quality. Your task is to assess how well a support response addresses the customer's specific issue.

Evaluation rubric:
- 1.0: Response directly and completely addresses every aspect of the customer's issue with no irrelevant content
- 0.7–0.9: Response addresses the main issue but misses some secondary concerns raised
- 0.4–0.6: Response partially addresses the issue; significant aspects are ignored or deflected
- 0.1–0.3: Response is mostly generic or addresses the wrong issue entirely
- 0.0: Response is completely irrelevant to the customer's message

Think through your reasoning step by step, then output your final score on the last line in this exact format:
SCORE: <number between 0 and 1>`;

export async function scoreRelevance(
  testCase: TestCase,
  response: string
): Promise<number> {
  const userPrompt = `## Customer Message
${testCase.input}

## Expected Topics to Address
${testCase.expected_topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## Support Response
${response}

Evaluate how well the response addresses the customer's issue and the expected topics. Reason through each expected topic, then provide your score.`;

  return callJudge(RELEVANCE_SYSTEM, userPrompt, `${testCase.id}/relevance`);
}

// ---------------------------------------------------------------------------
// Scorer 2: Empathy
// Does the response acknowledge the customer's emotional state appropriately?
// ---------------------------------------------------------------------------

const EMPATHY_SYSTEM = `You are an expert evaluator for customer support quality. Your task is to assess how empathetically a support response handles the customer's emotional state.

Evaluation rubric:
- 1.0: Response naturally and authentically acknowledges the customer's frustration/situation; empathy feels genuine and specific to their context, not scripted
- 0.7–0.9: Response shows clear empathy but may feel slightly formulaic or miss the emotional intensity of the situation
- 0.4–0.6: Response shows some acknowledgment but is predominantly transactional; the emotional dimension is treated as a checkbox
- 0.1–0.3: Response is cold or dismissive; the customer's emotional state is largely ignored
- 0.0: Response is actively hostile, condescending, or makes the situation worse

Important: For technical inquiries with neutral tone, a score of 0.6–0.8 is appropriate even without explicit emotional acknowledgment. Reserve high scores for cases where genuine human connection is demonstrated.

Think through your reasoning step by step, then output your final score on the last line in this exact format:
SCORE: <number between 0 and 1>`;

export async function scoreEmpathy(
  testCase: TestCase,
  response: string
): Promise<number> {
  const userPrompt = `## Customer Message
${testCase.input}

## Expected Tone
${testCase.expected_tone}

## Customer Context
Complexity: ${testCase.complexity}

## Support Response
${response}

Evaluate how empathetically the response handles the customer's emotional state and situation. Consider whether the tone matches what the customer needs. Then provide your score.`;

  return callJudge(EMPATHY_SYSTEM, userPrompt, `${testCase.id}/empathy`);
}

// ---------------------------------------------------------------------------
// Scorer 3: Accuracy
// Is the response factually coherent and free of hallucinated product details?
// ---------------------------------------------------------------------------

const ACCURACY_SYSTEM = `You are an expert evaluator for customer support quality. Your task is to assess the factual accuracy and coherence of a support response.

You are evaluating responses from "Aria", a support agent for Helix — a B2B SaaS platform. Known facts about Helix:
- Pricing tiers: Starter ($19/mo), Growth ($49/mo), Professional ($79/mo), Enterprise (custom)
- Features: project management, API access, SSO/SAML, CSV/JSON data export, webhooks, Chrome extension
- Billing cycles: monthly (1st of month) and annual (7-day renewal notice)
- Refunds: processed within 5-7 business days
- Priority support: available on Professional and Enterprise (4-hour response SLA)

Evaluation rubric:
- 1.0: All stated facts are accurate or appropriately hedged ("I'll check on this," "let me verify"); no confident claims about unknown specifics
- 0.7–0.9: Mostly accurate; minor imprecision that wouldn't mislead the customer
- 0.4–0.6: Contains one clearly inaccurate claim or contradicts known product facts
- 0.1–0.3: Multiple inaccuracies; response would actively mislead the customer
- 0.0: Response confidently states fabricated or contradictory information throughout

Think through your reasoning step by step, then output your final score on the last line in this exact format:
SCORE: <number between 0 and 1>`;

export async function scoreAccuracy(
  testCase: TestCase,
  response: string
): Promise<number> {
  const userPrompt = `## Customer Message
${testCase.input}

## Support Response
${response}

Evaluate the factual accuracy of this response. Check for: invented product features, incorrect pricing, impossible timelines, or confident claims about specifics that weren't established. Then provide your score.`;

  return callJudge(ACCURACY_SYSTEM, userPrompt, `${testCase.id}/accuracy`);
}

// ---------------------------------------------------------------------------
// Scorer 4: Resolution Clarity
// Does the response provide a clear next step or path to resolution?
// ---------------------------------------------------------------------------

const RESOLUTION_SYSTEM = `You are an expert evaluator for customer support quality. Your task is to assess whether a support response provides a clear, actionable path to resolution.

Evaluation rubric:
- 1.0: Response ends with a specific, concrete next step — either the agent commits to a clear action (e.g., "I'm escalating this to our infrastructure team now — you'll hear back within 2 hours") or gives the customer a precise action to take
- 0.7–0.9: A next step is present but is vague, conditional, or requires the customer to figure out details themselves
- 0.4–0.6: Response provides information but leaves the customer unclear on what happens next or what they should do
- 0.1–0.3: Response ends without any clear path forward; customer would need to follow up again to know what to do
- 0.0: Response makes the situation worse by adding confusion or contradictory instructions

Think through your reasoning step by step, then output your final score on the last line in this exact format:
SCORE: <number between 0 and 1>`;

export async function scoreResolutionClarity(
  testCase: TestCase,
  response: string
): Promise<number> {
  const userPrompt = `## Customer Message
${testCase.input}

## Support Response
${response}

Evaluate whether the response provides a clear, actionable path to resolution. Focus specifically on the ending: is there a concrete next step? Does the customer know what to expect or what to do? Then provide your score.`;

  return callJudge(RESOLUTION_SYSTEM, userPrompt, `${testCase.id}/resolution_clarity`);
}

// ---------------------------------------------------------------------------
// Aggregate scorer — runs all four in parallel
// ---------------------------------------------------------------------------

export interface ScoreResult {
  relevance: number;
  empathy: number;
  accuracy: number;
  resolution_clarity: number;
}

export async function scoreAll(
  testCase: TestCase,
  response: string
): Promise<ScoreResult> {
  const [relevance, empathy, accuracy, resolution_clarity] = await Promise.all([
    scoreRelevance(testCase, response),
    scoreEmpathy(testCase, response),
    scoreAccuracy(testCase, response),
    scoreResolutionClarity(testCase, response),
  ]);

  return { relevance, empathy, accuracy, resolution_clarity };
}
