/**
 * Customer Support Eval Suite — Braintrust Integration
 *
 * Architecture at a glance:
 *   dataset.ts  → 20 realistic support tickets with metadata
 *   pipeline.ts → GPT-4o support agent generates a response
 *   scorers.ts  → 4 LLM-as-judge dimensions scored independently
 *   index.ts    → Braintrust Eval() wires it all together
 *
 * Each test case produces 5 API calls: 1 generation + 4 judge calls.
 * All four judges run in parallel per test case.
 *
 * Resilience model:
 *   - withRetry() wraps every outbound API call we own (OpenAI generation +
 *     judging) with exponential backoff so transient errors resolve before
 *     they surface to Braintrust's Eval() loop.
 *   - The task function catches any remaining errors so a single failed case
 *     logs a null output and continues rather than aborting the entire suite.
 *   - Braintrust's own HTTP layer (e.g. /experiment-comparison2) is internal
 *     to the SDK; those calls are not retryable from userland. If the SDK
 *     surfaces a 500, catching errors in task() means at most one row is
 *     lost rather than the whole run.
 */

import "dotenv/config";
import { Eval } from "braintrust";
import Table from "cli-table3";
import { config } from "./config";
import { dataset, type TestCase } from "./dataset";
import { generateSupportResponse } from "./pipeline";
import { scoreAll, type ScoreResult } from "./scorers";

// ---------------------------------------------------------------------------
// Retry utility — exponential backoff with jitter
// ---------------------------------------------------------------------------

interface RetryOptions {
  maxAttempts?: number;   // default 4
  baseDelayMs?: number;   // default 500ms
  maxDelayMs?: number;    // default 10_000ms
  /** Return true to retry on this error; false to rethrow immediately. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 4,
    baseDelayMs = 2_000,
    maxDelayMs = 10_000,
    shouldRetry = isRetryable,
  } = opts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }

      // Fixed exponential backoff: 2000ms → 4000ms → 8000ms
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      console.log(
        `  [retry] attempt ${attempt}/${maxAttempts - 1} failed — ` +
          `retrying in ${delay}ms (${errorMessage(err)})`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Retry on network errors, rate limits, and 5xx server errors
    if (
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("fetch failed") ||
      msg.includes("network")
    ) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalInput {
  testCase: TestCase;
}

interface EvalExpected {
  topics: string[];
  tone: string;
  complexity: string;
}

// Accumulate results for the summary table printed at the end
const results: Array<{
  id: string;
  scores: ScoreResult;
}> = [];

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

let completedCount = 0;
const total = dataset.length;

function logProgress(id: string, scores: ScoreResult): void {
  completedCount++;
  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / 4;
  const bar = "█".repeat(Math.round(avg * 10)) + "░".repeat(10 - Math.round(avg * 10));
  console.log(
    `  [${completedCount.toString().padStart(2)}/${total}] ${id.padEnd(16)} ` +
      `rel=${scores.relevance.toFixed(2)} ` +
      `emp=${scores.empathy.toFixed(2)} ` +
      `acc=${scores.accuracy.toFixed(2)} ` +
      `res=${scores.resolution_clarity.toFixed(2)} ` +
      `avg=${avg.toFixed(2)} ${bar}`
  );
}

// ---------------------------------------------------------------------------
// Braintrust scorer adapters
// Each adapter receives {input, output} from Braintrust and delegates
// to our LLM-as-judge scoring functions.
// ---------------------------------------------------------------------------

// Scorer adapters — each wraps its LLM judge call in withRetry so transient
// OpenAI errors don't null out a score unnecessarily. A score of null tells
// Braintrust to omit it from aggregates rather than skew them toward 0.

async function relevanceScorer({
  input,
  output,
}: {
  input: EvalInput;
  output: string;
}): Promise<{ name: string; score: number | null }> {
  const { scoreRelevance } = await import("./scorers");
  try {
    const score = await withRetry(() => scoreRelevance(input.testCase, output));
    return { name: "relevance", score };
  } catch (err) {
    console.error(`  [scorer] relevance failed for ${input.testCase.id}: ${errorMessage(err)}`);
    return { name: "relevance", score: null };
  }
}

async function empathyScorer({
  input,
  output,
}: {
  input: EvalInput;
  output: string;
}): Promise<{ name: string; score: number | null }> {
  const { scoreEmpathy } = await import("./scorers");
  try {
    const score = await withRetry(() => scoreEmpathy(input.testCase, output));
    return { name: "empathy", score };
  } catch (err) {
    console.error(`  [scorer] empathy failed for ${input.testCase.id}: ${errorMessage(err)}`);
    return { name: "empathy", score: null };
  }
}

async function accuracyScorer({
  input,
  output,
}: {
  input: EvalInput;
  output: string;
}): Promise<{ name: string; score: number | null }> {
  const { scoreAccuracy } = await import("./scorers");
  try {
    const score = await withRetry(() => scoreAccuracy(input.testCase, output));
    return { name: "accuracy", score };
  } catch (err) {
    console.error(`  [scorer] accuracy failed for ${input.testCase.id}: ${errorMessage(err)}`);
    return { name: "accuracy", score: null };
  }
}

async function resolutionClarityScorer({
  input,
  output,
}: {
  input: EvalInput;
  output: string;
}): Promise<{ name: string; score: number | null }> {
  const { scoreResolutionClarity } = await import("./scorers");
  try {
    const score = await withRetry(() => scoreResolutionClarity(input.testCase, output));
    return { name: "resolution_clarity", score };
  } catch (err) {
    console.error(`  [scorer] resolution_clarity failed for ${input.testCase.id}: ${errorMessage(err)}`);
    return { name: "resolution_clarity", score: null };
  }
}

// ---------------------------------------------------------------------------
// Main eval runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║      Customer Support Eval Suite — Braintrust        ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`  Project:    ${config.projectName}`);
  console.log(`  Experiment: ${config.experimentName}`);
  console.log(`  Dataset:    ${dataset.length} test cases`);
  console.log(`  Model:      ${config.generationModel} (generation + judging)`);
  console.log(`  Scorers:    relevance · empathy · accuracy · resolution_clarity`);
  console.log("\n  Running eval (5 API calls per test case)...\n");

  const evalResult = await Eval<EvalInput, string, EvalExpected>(config.projectName, {
    experimentName: config.experimentName,

    data: () =>
      dataset.map((tc) => ({
        input: { testCase: tc },
        expected: {
          topics: tc.expected_topics,
          tone: tc.expected_tone,
          complexity: tc.complexity,
        },
        metadata: {
          id: tc.id,
          complexity: tc.complexity,
          expected_tone: tc.expected_tone,
        },
      })),

    task: async (input: EvalInput): Promise<string> => {
      const { id } = input.testCase;

      // Throttle between test cases to stay within OpenAI rate limits.
      // Runs before every case, including the first, which is fine —
      // the 2s is negligible relative to the ~5 API calls per case.
      await sleep(2_000);

      // Generation failure is fatal for this case — nothing to score.
      let response: string;
      try {
        ({ response } = await withRetry(
          () => generateSupportResponse(input.testCase.input)
        ));
      } catch (err) {
        completedCount++;
        console.error(
          `  [${completedCount.toString().padStart(2)}/${total}] ${id.padEnd(16)} FAILED (generation) — ${errorMessage(err)}`
        );
        return ""; // Braintrust records the row; scorer adapters return null scores
      }

      // Local scoring is used only for the progress display and summary table.
      // If it fails, we still return the response — Braintrust will score it
      // independently via the scorer adapters above.
      try {
        const scores = await scoreAll(input.testCase, response);
        logProgress(id, scores);
        results.push({ id, scores });
      } catch (err) {
        completedCount++;
        console.warn(
          `  [${completedCount.toString().padStart(2)}/${total}] ${id.padEnd(16)} WARN (local scoring) — ${errorMessage(err)}`
        );
        // Don't push to results — this row will be absent from the local
        // summary table but will still appear in Braintrust with scores
        // from the adapter calls.
      }

      return response;
    },

    scores: [
      relevanceScorer,
      empathyScorer,
      accuracyScorer,
      resolutionClarityScorer,
    ],
  });

  // -------------------------------------------------------------------------
  // Summary table
  // -------------------------------------------------------------------------

  console.log("\n\n  ─────────────────────────────────────────────────────");
  console.log("  RESULTS SUMMARY");
  console.log("  ─────────────────────────────────────────────────────\n");

  const table = new Table({
    head: ["Test Case", "Relevance", "Empathy", "Accuracy", "Resolution", "Average"],
    colWidths: [18, 11, 10, 11, 12, 10],
    style: { head: ["cyan"] },
  });

  const totals: ScoreResult = {
    relevance: 0,
    empathy: 0,
    accuracy: 0,
    resolution_clarity: 0,
  };

  // Sort by test case ID order (matching dataset order)
  const sortedResults = [...results].sort((a, b) => {
    const idxA = dataset.findIndex((tc) => tc.id === a.id);
    const idxB = dataset.findIndex((tc) => tc.id === b.id);
    return idxA - idxB;
  });

  for (const { id, scores } of sortedResults) {
    const avg = Object.values(scores).reduce((a, b) => a + b, 0) / 4;
    table.push([
      id,
      scores.relevance.toFixed(2),
      scores.empathy.toFixed(2),
      scores.accuracy.toFixed(2),
      scores.resolution_clarity.toFixed(2),
      avg.toFixed(2),
    ]);
    totals.relevance += scores.relevance;
    totals.empathy += scores.empathy;
    totals.accuracy += scores.accuracy;
    totals.resolution_clarity += scores.resolution_clarity;
  }

  // Averages row
  const n = results.length || 1;
  const overallAvg =
    (totals.relevance + totals.empathy + totals.accuracy + totals.resolution_clarity) /
    (4 * n);
  table.push([
    "AVERAGE",
    (totals.relevance / n).toFixed(2),
    (totals.empathy / n).toFixed(2),
    (totals.accuracy / n).toFixed(2),
    (totals.resolution_clarity / n).toFixed(2),
    overallAvg.toFixed(2),
  ]);

  console.log(table.toString());

  // Braintrust experiment URL
  if (evalResult.results && evalResult.results.length > 0) {
    console.log(`\n  Experiment logged to Braintrust.`);
  }
  console.log(`\n  Overall score: ${overallAvg.toFixed(3)} / 1.000`);
  console.log(
    `\n  View results at: https://www.braintrust.dev/app/experiments/${config.experimentName}\n`
  );
}

main().catch((err) => {
  console.error("\n  Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
