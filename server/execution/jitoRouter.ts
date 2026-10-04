import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { config } from '../config';
import { logger } from '../logger';
import { WalletManager } from '../walletManager';

// Official Jito tip accounts for mainnet
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crnq6HNQqf4uAzNWbwtbZ99uCXh',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

export interface JitoBundleResult {
  success: boolean;
  bundleId?: string;
  error?: string;
  available: boolean;
}

export class JitoRouter {
  private walletManager: WalletManager;
  private blockEngineUrl: string;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
    this.blockEngineUrl = config.JITO_BLOCK_ENGINE_URL || 'https://mainnet.block-engine.jito.wtf';
  }

  public isAvailable(): boolean {
    return Boolean(config.JITO_BLOCK_ENGINE_URL && this.walletManager.hasPrivateKey());
  }

  /**
   * Get random active Jito tip account
   */
  public getRandomTipAccount(): PublicKey {
    const randomAddress = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    return new PublicKey(randomAddress);
  }

  /**
   * Create Jito tip transfer instruction
   */
  public createTipInstruction(payer: PublicKey, tipLamports: number): TransactionInstruction {
    return SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: this.getRandomTipAccount(),
      lamports: tipLamports,
    });
  }

  /**
   * Submits bundle to Jito Block Engine
   */
  public async submitBundle(signedTransactions: VersionedTransaction[]): Promise<JitoBundleResult> {
    if (!config.LIVE_TRADING_ENABLED) {
      return {
        success: false,
        available: false,
        error: 'LIVE_TRADING_DISABLED: Server environment LIVE_TRADING_ENABLED is false. Jito bundle execution forbidden.',
      };
    }

    if (!this.walletManager.hasPrivateKey()) {
      return {
        success: false,
        available: false,
        error: 'WALLET_NOT_CONFIGURED: Wallet is required for Jito bundle execution',
      };
    }

    try {
      const serializedTxs = signedTransactions.map((tx) => Buffer.from(tx.serialize()).toString('base64'));

      const response = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [serializedTxs],
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('JitoRouter', `Jito Block Engine rejected bundle: ${errorText}`);
        return {
          success: false,
          available: true,
          error: `JITO_ENGINE_ERROR: ${errorText}`,
        };
      }

      const json = await response.json();
      if (json.error) {
        logger.error('JitoRouter', `Jito JSON-RPC error: ${JSON.stringify(json.error)}`);
        return {
          success: false,
          available: true,
          error: `JITO_RPC_ERROR: ${json.error.message || JSON.stringify(json.error)}`,
        };
      }

      const bundleId = json.result;
      logger.info('JitoRouter', `🚀 Jito Bundle submitted successfully! Bundle ID: ${bundleId}`);
      return {
        success: true,
        bundleId,
        available: true,
      };
    } catch (err: any) {
      logger.error('JitoRouter', `Jito bundle submission failure: ${err.message}`);
      return {
        success: false,
        available: false,
        error: `JITO_UNAVAILABLE: ${err.message}`,
      };
    }
  }
}
