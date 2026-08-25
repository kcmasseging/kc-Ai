import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  KC_AI_ENV: z.enum(['development', 'test', 'production']).default('development'),
  KC_AI_PORT: z.coerce.number().int().positive().default(3000),
  KC_AI_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  KC_AI_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  KC_AI_JWT_SECRET: z.string().min(16).default('development-secret-change-me'),
  KC_AI_SECRET_BUS_KEY: z.string().min(32).optional(),
  KC_AI_SECRET_BUS_PATH: z.string().default('.kc-ai-secrets.json'),
  KC_AI_OWNER_ID: z.string().min(1).default('owner'),
  KC_AI_OWNER_PASSWORD_HASH: z.string().optional(),
  KC_AI_OWNER_INITIALIZATION_SECRET: z.string().min(32).optional(),
  KC_AI_OWNER_BOOTSTRAP_PASSWORD: z.string().optional(),
  KC_AI_TASK_STORE_PATH: z.string().default('.kc-ai-tasks.json'),
  KC_AI_AUDIT_STORE_PATH: z.string().default('.kc-ai-audit.json'),
  KC_AI_TASK_HISTORY_STORE_PATH: z.string().default('.kc-ai-task-history.json'),
  KC_AI_WALLET_STORE_PATH: z.string().default('.kc-ai-wallets.json'),
  KC_AI_STORAGE_DRIVER: z.enum(['local', 'postgres']).default('local'),
  KC_AI_DATABASE_URL: z.string().url().optional(),
  KC_AI_DATABASE_SSL: z.coerce.boolean().default(false),
  KC_AI_TTS_PROVIDER: z.enum(['browser', 'azure', 'google']).default('browser'),
  KC_AI_TTS_VOICE: z.string().default('en-US-JennyNeural'),
  KC_AI_ENABLE_VOICE: z.coerce.boolean().default(true),
  KC_AI_ENABLE_WELCOME: z.coerce.boolean().default(true),
  KC_AI_WEB_SEARCH_PROVIDER: z.enum(['brave', 'exa']).optional(),
  KC_AI_WEB_SEARCH_API_KEY: z.string().min(1).optional(),
  KC_AI_WEB_SEARCH_ENDPOINT: z.string().url().optional(),
  EXA_API_KEY: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);

if (env.KC_AI_ENV === 'production' && (env.KC_AI_JWT_SECRET === 'development-secret-change-me' || (!env.KC_AI_OWNER_PASSWORD_HASH && !env.KC_AI_OWNER_INITIALIZATION_SECRET) || env.KC_AI_OWNER_BOOTSTRAP_PASSWORD)) {
  throw new Error('Production requires KC_AI_JWT_SECRET and either KC_AI_OWNER_PASSWORD_HASH or KC_AI_OWNER_INITIALIZATION_SECRET; bootstrap passwords are disabled');
}

if (env.KC_AI_ENV === 'production' && (env.KC_AI_STORAGE_DRIVER !== 'postgres' || !env.KC_AI_DATABASE_URL)) {
  throw new Error('Production requires KC_AI_STORAGE_DRIVER=postgres and KC_AI_DATABASE_URL');
}

export const allowedOrigins = env.KC_AI_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
