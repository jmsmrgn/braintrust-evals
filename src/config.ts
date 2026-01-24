import "dotenv/config";

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
        `Copy .env.example to .env and fill in your API keys.`
    );
  }
  return value;
}

export const config = {
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  braintrustApiKey: requireEnv("BRAINTRUST_API_KEY"),

  // Models
  generationModel: "gpt-4o" as const,
  judgingModel: "gpt-4o-mini" as const,

  // Experiment metadata
  experimentName: "customer-support-evals-v1",
  projectName: "customer-support-evals",

  // Generation parameters
  generation: {
    maxTokens: 512,
    temperature: 0.3, // Low temp for consistent support responses
  },

  // Judging parameters — slightly higher temp to avoid judge collapse
  judging: {
    maxTokens: 256,
    temperature: 0.1,
  },
} as const;
