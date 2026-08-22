import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "eve";

const qwen = createOpenAI({
  apiKey: process.env.QWEN_API_KEY ?? "local-only",
  baseURL: process.env.QWEN_BASE_URL ?? "http://127.0.0.1:9000/v1",
  name: "gb10-qwen",
});

export default defineAgent({
  model: qwen.chat(process.env.QWEN_MODEL_ID ?? "Qwen3.6-35B-A3B-NVFP4"),
  modelContextWindowTokens: 131_072,
  limits: {
    maxInputTokensPerSession: 1_000_000,
    maxOutputTokensPerSession: 100_000,
    sessionTimeoutMs: 24 * 60 * 60 * 1_000,
  },
});
