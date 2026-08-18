import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  KC_AI_ENV: z.enum(['development', 'test', 'production']).default('development'),
  KC_AI_PORT: z.coerce.number().int().positive().default(3000),
  KC_AI_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  KC_AI_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  KC_AI_JWT_SECRET: z.string().min(16).default('development-secret-change-me'),
  KC_AI_TTS_PROVIDER: z.enum(['browser', 'azure', 'google']).default('browser'),
  KC_AI_TTS_VOICE: z.string().default('en-US-JennyNeural'),
  KC_AI_ENABLE_VOICE: z.coerce.boolean().default(true),
  KC_AI_ENABLE_WELCOME: z.coerce.boolean().default(true),
});

export const env = envSchema.parse(process.env);

export const allowedOrigins = env.KC_AI_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
