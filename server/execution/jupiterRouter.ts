import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { config } from '../config';
import { logger } from '../logger';
import { WalletManager } from '../walletManager';

export interface SwapExecutionResult {
  success: boolean;
  txHash: string;
  error?: string;
  inAmountLamports?: number;
  outAmountRaw?: string;
}

export class JupiterRouter {
  private walletManager: WalletManager;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
  }

  /**
   * Executes a live buy on Solana mainnet via Jupiter API v6
   */
  public async executeLiveBuy(
    outputMint: string,
    amountSol: number,
    slippagePercent: number,
    priorityFeeSol: number = 0.005
  ): Promise<SwapExecutionResult> {
    // HARD INVARIANT: Prevent live trading execution when disabled in server environment
    if (!config.LIVE_TRADING_ENABLED) {
      return {
        success: false,
        txHash: '',
        error: 'LIVE_TRADING_DISABLED: Server environment LIVE_TRADING_ENABLED is false. On-chain execution forbidden.',
      };
    }

    const pubkey = this.walletManager.getPublicKey();
    if (!pubkey || !this.walletManager.hasPrivateKey()) {
      return { success: false, txHash: '', error: 'WALLET_NOT_CONFIGURED: No live private key in server memory' };
    }

    const connection = this.walletManager.getConnection();
    const lamports = Math.floor(amountSol * 1e9);
    const slippageBps = Math.floor(slippagePercent * 100);

    try {
      // 1. Check live wallet balance with safety margin for transaction gas
      const currentBalance = await connection.getBalance(pubkey, 'confirmed');
      const minRequired = lamports + 5_000_000; // trade amount + 0.005 SOL buffer
      if (currentBalance < minRequired) {
        return {
          success: false,
          txHash: '',
          error: `INSUFFICIENT_BALANCE: Wallet has ${(currentBalance / 1e9).toFixed(4)} SOL, required ${(minRequired / 1e9).toFixed(4)} SOL`,
        };
      }

      // 2. Fetch quote from Jupiter API
      const inputMint = 'So11111111111111111111111111111111111111112'; // WSOL
      const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${lamports}&slippageBps=${slippageBps}`;

      const quoteRes = await fetch(quoteUrl, { signal: AbortSignal.timeout(6000) });
      if (!quoteRes.ok) {
        const errText = await quoteRes.text();
        return { success: false, txHash: '', error: `JUPITER_QUOTE_ERROR: ${errText}` };
      }

      const quoteData = await quoteRes.json();
      if (!quoteData || !quoteData.outAmount) {
        return { success: false, txHash: '', error: 'NO_SWAP_ROUTE: Jupiter could not find a swap route for this token' };
      }

      // 3. Request serialized transaction from Jupiter swap endpoint
      const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: pubkey.toBase58(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: Math.floor(priorityFeeSol * 1e9),
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!swapRes.ok) {
        const errText = await swapRes.text();
        return { success: false, txHash: '', error: `JUPITER_BUILD_ERROR: ${errText}` };
      }

      const { swapTransaction } = await swapRes.json();
      const txBuffer = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);

      // 4. Sign transaction in server memory
      this.walletManager.signTransaction(tx);

      // 5. Pre-flight RPC Simulation to catch slippage/contract revert before spending gas
      try {
        const simResult = await connection.simulateTransaction(tx, { commitment: 'processed' });
        if (simResult.value.err) {
          logger.warn('JupiterRouter', 'Pre-flight simulation returned error:', simResult.value.err);
          return {
            success: false,
            txHash: '',
            error: `SIMULATION_FAILED: ${JSON.stringify(simResult.value.err)}`,
          };
        }
      } catch (simErr: any) {
        logger.warn('JupiterRouter', `Pre-flight simulation check failed (${simErr.message}), proceeding to send`);
      }

      // 6. Broadcast raw transaction
      const rawTx = tx.serialize();
      const txSignature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 3,
      });

      logger.info('JupiterRouter', `🚀 Transaction broadcasted: ${txSignature}. Awaiting confirmation...`);

      // 7. Await on-chain confirmation
      let isConfirmed = false;
      try {
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        const confirmation = await connection.confirmTransaction(
          {
            signature: txSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        );

        if (confirmation.value.err) {
          logger.error('JupiterRouter', `Transaction reverted on-chain: ${txSignature}`, confirmation.value.err);
          return {
            success: false,
            txHash: txSignature,
            error: `TRANSACTION_REVERTED: ${JSON.stringify(confirmation.value.err)}`,
          };
        }
        isConfirmed = true;
      } catch (confirmErr: any) {
        logger.warn('JupiterRouter', `Initial confirmTransaction timed out/errored for ${txSignature}: ${confirmErr.message}. Checking status...`);
        try {
          const statusRes = await connection.getSignatureStatuses([txSignature]);
          const status = statusRes.value[0];
          if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
            if (status.err) {
              return {
                success: false,
                txHash: txSignature,
                error: `TRANSACTION_REVERTED: ${JSON.stringify(status.err)}`,
              };
            }
            isConfirmed = true;
          } else {
            return {
              success: false,
              txHash: txSignature,
              error: `TRANSACTION_TIMEOUT: Transaction broadcasted (${txSignature}) but confirmation timed out. Previous transaction may still land; do not retry without verification.`,
            };
          }
        } catch {
          return {
            success: false,
            txHash: txSignature,
            error: `TRANSACTION_TIMEOUT: Transaction broadcasted (${txSignature}) but confirmation timed out. Do not retry blindly.`,
          };
        }
      }

      logger.info('JupiterRouter', `✅ Transaction confirmed on-chain: ${txSignature}`);
      this.walletManager.refreshBalance().catch(() => {});

      return {
        success: true,
        txHash: txSignature,
        inAmountLamports: lamports,
        outAmountRaw: quoteData.outAmount,
      };
    } catch (err: any) {
      logger.error('JupiterRouter', 'Live buy swap execution error:', err);
      return { success: false, txHash: '', error: err.message || 'Swap execution failed' };
    }
  }

  /**
   * Executes a live sell on Solana mainnet via Jupiter API v6
   */
  public async executeLiveSell(
    inputMint: string,
    percent: number,
    slippagePercent: number,
    priorityFeeSol: number = 0.005
  ): Promise<SwapExecutionResult> {
    // HARD INVARIANT: Prevent live trading execution when disabled in server environment
    if (!config.LIVE_TRADING_ENABLED) {
      return {
        success: false,
        txHash: '',
        error: 'LIVE_TRADING_DISABLED: Server environment LIVE_TRADING_ENABLED is false. On-chain execution forbidden.',
      };
    }

    const pubkey = this.walletManager.getPublicKey();
    if (!pubkey || !this.walletManager.hasPrivateKey()) {
      return { success: false, txHash: '', error: 'WALLET_NOT_CONFIGURED: No live private key in server memory' };
    }

    const connection = this.walletManager.getConnection();
    const slippageBps = Math.floor(slippagePercent * 100);

    try {
      // 1. Locate on-chain token account
      let tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
        mint: new PublicKey(inputMint),
      });

      // Retry up to 3 times with 800ms delay for RPC indexing
      if (!tokenAccounts.value || tokenAccounts.value.length === 0) {
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 800));
          tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
            mint: new PublicKey(inputMint),
          });
          if (tokenAccounts.value && tokenAccounts.value.length > 0) break;
        }
      }

      // Check Token-2022 if standard SPL not found
      if (!tokenAccounts.value || tokenAccounts.value.length === 0) {
        try {
          const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
          const token2022Accounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
            programId: TOKEN_2022_PROGRAM_ID,
          });
          const match = token2022Accounts.value.filter((acc) => acc.account.data.parsed.info.mint === inputMint);
          if (match.length > 0) {
            tokenAccounts = { value: match } as any;
          }
        } catch {}
      }

      if (!tokenAccounts.value || tokenAccounts.value.length === 0) {
        return { success: false, txHash: '', error: 'NO_TOKEN_ACCOUNT: No on-chain token balance found for this mint' };
      }

      const totalBalanceRaw = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
      if (!totalBalanceRaw || BigInt(totalBalanceRaw) <= 0n) {
        return { success: false, txHash: '', error: 'ZERO_TOKEN_BALANCE: On-chain token balance is 0' };
      }

      const totalBig = BigInt(totalBalanceRaw);
      const sellAmountBig = percent >= 100 ? totalBig : (totalBig * BigInt(percent)) / 100n;

      if (sellAmountBig <= 0n) {
        return { success: false, txHash: '', error: 'INVALID_SELL_AMOUNT: Calculated sell token amount is 0' };
      }

      // 2. Request Jupiter quote (Token -> WSOL)
      const outputMint = 'So11111111111111111111111111111111111111112'; // WSOL
      const quoteUrl = `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${sellAmountBig.toString()}&slippageBps=${slippageBps}`;

      const quoteRes = await fetch(quoteUrl, { signal: AbortSignal.timeout(6000) });
      if (!quoteRes.ok) {
        const errText = await quoteRes.text();
        return { success: false, txHash: '', error: `JUPITER_SELL_QUOTE_ERROR: ${errText}` };
      }

      const quoteData = await quoteRes.json();
      if (!quoteData || !quoteData.outAmount) {
        return { success: false, txHash: '', error: 'NO_SELL_ROUTE: Jupiter could not route token to SOL' };
      }

      // 3. Build swap transaction
      const swapRes = await fetch('https://api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quoteData,
          userPublicKey: pubkey.toBase58(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: Math.floor(priorityFeeSol * 1e9),
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!swapRes.ok) {
        const errText = await swapRes.text();
        return { success: false, txHash: '', error: `JUPITER_BUILD_ERROR: ${errText}` };
      }

      const { swapTransaction } = await swapRes.json();
      const txBuffer = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuffer);

      // 4. Sign transaction in server memory
      this.walletManager.signTransaction(tx);

      // 5. Pre-flight RPC simulation before broadcasting
      try {
        const simResult = await connection.simulateTransaction(tx, { commitment: 'processed' });
        if (simResult.value.err) {
          logger.warn('JupiterRouter', 'Pre-flight sell simulation returned error:', simResult.value.err);
          return {
            success: false,
            txHash: '',
            error: `SELL_SIMULATION_FAILED: ${JSON.stringify(simResult.value.err)}`,
          };
        }
      } catch (simErr: any) {
        logger.warn('JupiterRouter', `Pre-flight sell simulation check failed (${simErr.message}), proceeding to send`);
      }

      // 6. Broadcast raw transaction
      const rawTx = tx.serialize();
      const txSignature = await connection.sendRawTransaction(rawTx, {
        skipPreflight: true,
        maxRetries: 3,
      });

      logger.info('JupiterRouter', `🚀 Sell transaction broadcasted: ${txSignature}. Awaiting confirmation...`);

      // 7. Confirm transaction
      let isConfirmed = false;
      try {
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        const confirmation = await connection.confirmTransaction(
          {
            signature: txSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          'confirmed'
        );

        if (confirmation.value.err) {
          logger.error('JupiterRouter', `Sell transaction reverted on-chain: ${txSignature}`, confirmation.value.err);
          return {
            success: false,
            txHash: txSignature,
            error: `SELL_REVERTED: ${JSON.stringify(confirmation.value.err)}`,
          };
        }
        isConfirmed = true;
      } catch (confirmErr: any) {
        logger.warn('JupiterRouter', `Initial sell confirmTransaction timed out/errored for ${txSignature}: ${confirmErr.message}. Checking status...`);
        try {
          const statusRes = await connection.getSignatureStatuses([txSignature]);
          const status = statusRes.value[0];
          if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
            if (status.err) {
              return {
                success: false,
                txHash: txSignature,
                error: `SELL_REVERTED: ${JSON.stringify(status.err)}`,
              };
            }
            isConfirmed = true;
          } else {
            return {
              success: false,
              txHash: txSignature,
              error: `TRANSACTION_TIMEOUT: Sell broadcasted (${txSignature}) but confirmation timed out. Previous transaction may still land; do not retry without verification.`,
            };
          }
        } catch {
          return {
            success: false,
            txHash: txSignature,
            error: `TRANSACTION_TIMEOUT: Sell broadcasted (${txSignature}) but confirmation timed out. Do not retry blindly.`,
          };
        }
      }

      logger.info('JupiterRouter', `✅ Sell confirmed on-chain: ${txSignature}`);
      this.walletManager.refreshBalance().catch(() => {});

      return {
        success: true,
        txHash: txSignature,
        outAmountRaw: quoteData.outAmount,
      };
    } catch (err: any) {
      logger.error('JupiterRouter', 'Live sell execution error:', err);
      return { success: false, txHash: '', error: err.message || 'Sell execution failed' };
    }
  }
}
