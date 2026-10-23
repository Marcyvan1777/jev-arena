import 'dotenv/config';
import { z } from 'zod';
const settings = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  MAX_ROUNDS: z.coerce.number().int().min(10).max(200).default(100),
  JEV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(12000),
  JEV_RETRIES: z.coerce.number().int().min(0).max(1).default(1),
  TYPESAFE_MODEL: z.string().min(1).default('jev-latest'),
  OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
  CLAUDE_MODEL: z.string().min(1).default('claude-haiku-5-5'),
}).parse(process.env);
export const config = { port: settings.PORT, maxRounds: settings.MAX_ROUNDS,
  timeoutMs: settings.JEV_TIMEOUT_MS, retries: settings.JEV_RETRIES, model: settings.TYPESAFE_MODEL, openaiModel: settings.OPENAI_MODEL, claudeModel: settings.CLAUDE_MODEL };
export const hasApiKey = () => Boolean(process.env.TYPESAFE_API_KEY?.trim());
export const hasOpenAiKey = () => Boolean(process.env.OPENAI_API_KEY?.trim());
export const hasClaudeKey = () => Boolean(process.env.ANTHROPIC_API_KEY?.trim());
