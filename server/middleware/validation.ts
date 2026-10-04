import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const manualSnipeSchema = z.object({
  tokenAddress: z.string().regex(solanaAddressRegex, 'Invalid Solana token address format'),
  amountSol: z.number().positive('Amount must be positive').max(10, 'Amount exceeds maximum limit'),
  slippagePercent: z.number().positive('Slippage must be positive').max(50, 'Slippage cannot exceed 50%').optional(),
});

export const sellPositionSchema = z.object({
  positionId: z.string().min(1, 'Position ID is required'),
  percent: z.number().min(1, 'Percent must be at least 1%').max(100, 'Percent cannot exceed 100%').default(100),
  reason: z.enum(['manual', 'tp', 'sl', 'trailing', 'stagnant']).default('manual'),
});

export const updateTargetsSchema = z.object({
  positionId: z.string().min(1, 'Position ID is required'),
  targets: z.object({
    tpPercent: z.number().min(0).max(5000).optional(),
    slPercent: z.number().min(0).max(100).optional(),
    trailingStopPercent: z.number().min(0).max(100).optional(),
    autoSellStagnant: z.boolean().optional(),
    stagnantTimeoutSeconds: z.number().min(10).max(86400).optional(),
  }),
});

export const importWalletSchema = z.object({
  privateKey: z.string().min(10, 'Private key is required'),
});

export const updateConfigSchema = z.object({
  autoSnipe: z.boolean().optional(),
  tradingAmountSol: z.number().positive().max(10).optional(),
  takeProfitPercent: z.number().min(0).max(5000).optional(),
  stopLossPercent: z.number().min(0).max(100).optional(),
  trailingStopPercent: z.number().min(0).max(100).optional(),
  autoSellStagnant: z.boolean().optional(),
  stagnantTimeoutSeconds: z.number().min(10).max(86400).optional(),
  stagnantThresholdPercent: z.number().min(0).max(50).optional(),
  slippagePercent: z.number().positive().max(50).optional(),
  maxRugCheckScore: z.number().min(0).max(2000).optional(),
  rejectOnRugCheckDanger: z.boolean().optional(),
  maxEntryMarketCapUsd: z.number().min(0).max(10000000).optional(),
  maxTokenAgeMinutes: z.number().min(0).max(10000).optional(),
  requirePositiveMomentum5m: z.boolean().optional(),
  router: z.enum(['jupiter', 'jito', 'gmgn']).optional(),
  executionMode: z.enum(['simulation', 'wallet']).optional(),
  priorityFeeSol: z.number().min(0).max(0.5).optional(),
  jitoTipSol: z.number().min(0).max(0.5).optional(),
  rpcUrl: z.string().url().optional(),
});

export function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request payload',
          details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
      });
      return;
    }
    req.body = parsed.data;
    next();
  };
}
