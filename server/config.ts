import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().default('http://localhost:3000'),
  FRONTEND_URL: z.string().optional(),

  // Security & Auth
  ADMIN_PASSWORD: z.string().optional().default(''),
  SESSION_SECRET: z.string().default('solsnipe-default-secret-change-in-prod-32-chars-min'),
  AUTO_LOCK_MINUTES: z.coerce.number().min(0).default(30),

  // Solana Network
  SOLANA_RPC_URL: z.string().url().default('https://api.mainnet-beta.solana.com'),
  SOLANA_RPC_BACKUP_URL: z.string().optional().default(''),

  // Solana Wallet (Live trading)
  SOLANA_PRIVATE_KEY: z.string().optional().default(''),

  // Global Live Trading Safety Switch (MUST be explicitly 'true' to execute live trades)
  LIVE_TRADING_ENABLED: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),

  // Operational Trading Mode (simulation vs live)
  TRADING_MODE: z.enum(['simulation', 'live']).default('simulation'),

  // Risk Management Limits
  MAX_POSITION_SIZE_SOL: z.coerce.number().positive().default(0.5),
  MAX_DAILY_LOSS_SOL: z.coerce.number().positive().default(2.0),
  MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(5),
  MAX_TOTAL_EXPOSURE_SOL: z.coerce.number().positive().default(2.0),
  MAX_TRADES_PER_HOUR: z.coerce.number().int().positive().default(20),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().min(50).max(5000).default(1500),

  // Telegram
  TELEGRAM_API_ID: z.coerce.number().optional(),
  TELEGRAM_API_HASH: z.string().optional().default(''),
  TELEGRAM_PHONE: z.string().optional().default(''),
  TELEGRAM_SESSION: z.string().optional(),
  TELEGRAM_SESSION_STRING: z.string().optional().default(''),
  TELEGRAM_CHANNELS: z.string().default('dexscreener_solana,pumpdotfunalert,solana_gems,solana_tracker'),

  // Integrations
  GMGN_API_KEY: z.string().optional().default(''),
  JITO_BLOCK_ENGINE_URL: z.string().optional().default('https://mainnet.block-engine.jito.wtf'),
  JITO_TIP_STREAM_URL: z.string().optional().default(''),
  JITO_AUTH_KEYPAIR: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[Config] Invalid environment configuration:');
  console.error(parsed.error.format());
  throw new Error('Environment configuration validation failed');
}

const rawConfig = parsed.data;

// Resolve aliases and enforce safety lock
const resolvedAppUrl = rawConfig.FRONTEND_URL || rawConfig.APP_URL;
const resolvedTelegramSession = rawConfig.TELEGRAM_SESSION_STRING || rawConfig.TELEGRAM_SESSION || '';

// Hard safety gate: If TRADING_MODE is simulation, LIVE_TRADING_ENABLED MUST be false
const safeLiveTrading = rawConfig.TRADING_MODE === 'live' && rawConfig.LIVE_TRADING_ENABLED === true;

export const config = {
  ...rawConfig,
  APP_URL: resolvedAppUrl,
  TELEGRAM_SESSION_STRING: resolvedTelegramSession,
  LIVE_TRADING_ENABLED: safeLiveTrading,
};

export type AppConfig = typeof config;
