# Customer Support Eval Suite

Most teams shipping LLM features are vibe-checking their outputs. This project is an attempt to do it properly.

It's a production-grade evaluation suite for a GPT-4o-powered customer support agent. Every response is scored across four dimensions using LLM-as-judge, and every run is logged to a Braintrust experiment for comparison, regression tracking, and analysis.

---

## What it evaluates

The suite runs 20 realistic support tickets through a GPT-4o agent — billing disputes, SSO failures, account compromises, angry customers threatening to cancel. The range matters: a good eval suite should cover the distribution of real traffic, not just the easy cases.

Each response is scored on four dimensions:

**Relevance** — Did the agent actually address what the customer asked? Generic acknowledgments that dodge the specific issue should score poorly here. This is the most basic signal and often the most revealing.

**Empathy** — Did the tone match what the situation called for? An account compromise warrants different handling than a CSV export question. This dimension is calibrated to reward appropriate tone, not performative warmth — hollow phrases like "I completely understand your frustration" don't score higher than a direct, human acknowledgment.

**Accuracy** — Did the agent hallucinate product details? Support agents trained on vague system prompts routinely invent pricing, timelines, and features. This scorer has the known product facts as context and flags confident claims that contradict or invent them.

**Resolution Clarity** — Does the customer know what happens next? This is where most support responses fail. A response can acknowledge the problem, show empathy, and state accurate facts while still leaving the customer with no idea what to do. This dimension specifically evaluates the ending of the response.

---

## How LLM-as-judge scoring works

Each scorer issues a separate GPT-4o call with a rubric that includes explicit anchors at 0, 0.5, and 1.0. The model is prompted to reason through its evaluation before returning a score — chain-of-thought elicitation that reduces score collapse without inflating the output token budget.

Design decisions worth noting:

- **One scorer per call, not one call for all four.** Combining dimensions in a single prompt causes anchoring: the model's rating on dimension 1 influences dimension 2. Separate calls are more expensive but produce more reliable signal.

- **Continuous scores, not buckets.** Scores are floats (0.0–1.0) rather than discrete 1–5 ratings. This preserves variance in the aggregate and makes it easier to detect regressions that shift the mean by 0.05 without crossing a tier boundary.

- **Low judging temperature.** Judge calls run at temperature 0.1 to reduce variance across runs. The judge model should be opinionated but consistent; high temperature makes the scores noisy enough that small real differences become invisible.

- **Known limitations.** LLM-as-judge has real weaknesses: it tends to favor longer responses, it can be sensitive to prompt ordering, and the judge model's biases become baked into your eval. These are tradeoffs, not dealbreakers — the alternative (manual scoring at scale) has worse tradeoffs.

---

## Setup

```bash
# Clone and install
git clone <repo>
cd braintrust-evals
npm install

# Configure API keys
cp .env.example .env
# Edit .env with your OPENAI_API_KEY and BRAINTRUST_API_KEY
```

Get your Braintrust API key from [braintrust.dev/settings](https://www.braintrust.dev/settings).

---

## Running the eval

```bash
npx ts-node src/index.ts
```

Each test case generates 5 API calls (1 generation + 4 judge calls). The four judge calls run in parallel per test case. At 20 test cases, expect ~100 API calls total and a runtime of 2–4 minutes depending on OpenAI latency.

Progress is printed live as each case completes:

```
  [ 1/20] billing-001      rel=0.92 emp=0.88 acc=0.95 res=0.85 avg=0.90 █████████░
  [ 2/20] billing-002      rel=0.78 emp=0.81 acc=0.90 res=0.72 avg=0.80 ████████░░
  ...
```

A summary table prints at the end with per-case and aggregate scores.

---

## What a Braintrust experiment looks like

After a run, the experiment is visible in the Braintrust UI with:

- A row per test case showing input, output, and all four scores
- Aggregate score distributions with histogram views
- The full judge reasoning is not stored by default (only the numeric score is logged), but can be added by returning metadata from the scorer

On subsequent runs, Braintrust automatically diffs the new experiment against the previous baseline — surfacing which cases regressed, which improved, and by how much. This is where the platform earns its keep: the diff view turns "did my prompt change make things better?" from a gut feeling into a data question.

---

## Extending it

**Regression testing in CI.** The `Eval()` function returns a result object with aggregate scores. Wire that into a CI step that fails the build if any dimension drops below a threshold — e.g., `accuracy < 0.85`. This gives you a meaningful LLM quality gate without human review on every PR.

**Expanding the dataset.** The 20 cases here cover the obvious archetypes. A real deployment would add cases sampled from actual support tickets (anonymized), with the expected topics derived from what your best human agents actually addressed. Diversity of phrasing matters more than volume: 50 structurally identical cases teach you nothing new.

**Prompt versioning.** The system prompt in `pipeline.ts` is the thing you're actually evaluating. Tag experiments with the prompt version, run both against the same dataset, and use Braintrust's experiment comparison to see the delta before shipping.

**Adding a human baseline.** The most useful thing you can do with an LLM judge is calibrate it against human ratings on a sample. If your judges and your humans agree on 80%+ of cases, the automated scores are trustworthy. If they diverge systematically — the judge always scores higher on long responses, say — you have a prompt engineering problem to fix.

---

## Stack

- **TypeScript** with strict mode
- **GPT-4o** for both generation and judging
- **Braintrust SDK** for experiment logging and comparison
- **dotenv** for environment configuration
- **cli-table3** for terminal output formatting
