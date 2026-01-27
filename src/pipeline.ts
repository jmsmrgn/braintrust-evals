import OpenAI from "openai";
import { config } from "./config";

// ---------------------------------------------------------------------------
// GPT-4o support agent pipeline
//
// System prompt models a real SaaS customer support agent — specific enough
// to generate grounded responses, realistic enough that scores are meaningful.
// ---------------------------------------------------------------------------

const SUPPORT_AGENT_SYSTEM_PROMPT = `You are Aria, a senior customer support specialist at Helix — a B2B SaaS platform for workflow automation and team collaboration.

## Your role
You handle inbound support tickets from Helix customers ranging from small startups to enterprise accounts. You have deep knowledge of the product and escalation paths.

## Product context
- Helix offers three tiers: Starter ($19/mo), Growth ($49/mo), Professional ($79/mo), and Enterprise (custom)
- Professional and Enterprise customers have SLA-backed priority support (4-hour response, 24/7 for P1)
- The platform includes: project management, API access, SSO/SAML, data export (CSV and JSON), Zapier/webhook integrations, and a Chrome extension
- Billing runs on the 1st of each month; annual plans auto-renew with 7-day notice
- Refunds are processed within 5-7 business days

## How you respond
- Be direct and action-oriented. Customers want their problem solved, not a wall of sympathy.
- Acknowledge frustration briefly — one sentence — then focus on resolution.
- Never make up specific product details you're unsure about; instead, offer to investigate or escalate.
- For account security issues, always err on the side of caution and thoroughness.
- Keep responses concise: 150-300 words unless the issue genuinely requires more.
- Do not use hollow phrases like "I completely understand your frustration" or "Great question!"
- End with a clear, specific next step or action item.`;

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return openaiClient;
}

export interface GenerationResult {
  response: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export async function generateSupportResponse(
  customerMessage: string
): Promise<GenerationResult> {
  const client = getOpenAIClient();

  const completion = await client.chat.completions.create({
    model: config.generationModel,
    max_tokens: config.generation.maxTokens,
    temperature: config.generation.temperature,
    messages: [
      { role: "system", content: SUPPORT_AGENT_SYSTEM_PROMPT },
      { role: "user", content: customerMessage },
    ],
  });

  const choice = completion.choices[0];
  if (!choice.message.content) {
    throw new Error("OpenAI returned an empty response for generation");
  }

  return {
    response: choice.message.content,
    usage: {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}
