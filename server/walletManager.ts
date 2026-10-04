import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config';
import { logger } from './logger';

const encodeBase58 = (bytes: Uint8Array): string => {
  const encoder = (bs58 as any).encode || (bs58 as any).default?.encode;
  if (typeof encoder === 'function') return encoder(bytes);
  return Buffer.from(bytes).toString('hex');
};

const decodeBase58 = (str: string): Uint8Array => {
  const decoder = (bs58 as any).decode || (bs58 as any).default?.decode;
  if (typeof decoder === 'function') return decoder(str);
  throw new Error('Base58 decode not supported');
};

const decodeKeyInput = (input: string): Uint8Array => {
  const trimmed = input.trim();
  // Support JSON byte array format [12,34,...]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && (parsed.length === 64 || parsed.length === 32)) {
        return new Uint8Array(parsed);
      }
    } catch {}
  }
  // Support Base58 string format (Phantom, Solflare, etc.)
  return decodeBase58(trimmed);
};

export interface SafeWalletStatus {
  publicKey: string;
  balanceSol: number;
  isConfigured: boolean;
  rpcHealthy: boolean;
  rpcUrl: string;
}

export class WalletManager {
  private keypair: Keypair | null = null;
  private connection: Connection;
  private cachedBalanceSol: number = 0;
  private lastBalanceCheck: number = 0;
  private isRpcHealthy: boolean = true;
  private currentRpcUrl: string;

  constructor(rpcUrl: string = config.SOLANA_RPC_URL) {
    this.currentRpcUrl = rpcUrl;
    this.connection = new Connection(this.currentRpcUrl, 'confirmed');

    // Load private key strictly from environment if available
    if (config.SOLANA_PRIVATE_KEY) {
      try {
        const decoded = decodeKeyInput(config.SOLANA_PRIVATE_KEY);
        this.keypair = decoded.length === 32 ? Keypair.fromSeed(decoded) : Keypair.fromSecretKey(decoded);
        logger.info('WalletManager', `Wallet loaded from environment variable: ${this.keypair.publicKey.toBase58()}`);
      } catch (err) {
        logger.error('WalletManager', 'Failed to load wallet from SOLANA_PRIVATE_KEY environment variable:', err);
      }
    } else {
      logger.info('WalletManager', 'No SOLANA_PRIVATE_KEY configured. Simulation mode active.');
    }

    this.refreshBalance().catch(() => {});
  }

  public getConnection(): Connection {
    return this.connection;
  }

  public setRpcUrl(newRpcUrl: string): void {
    if (!newRpcUrl || !newRpcUrl.startsWith('http')) return;
    this.currentRpcUrl = newRpcUrl;
    this.connection = new Connection(newRpcUrl, 'confirmed');
    logger.info('WalletManager', `Solana RPC updated to: ${newRpcUrl}`);
    this.refreshBalance().catch(() => {});
  }

  public getPublicKeyString(): string {
    return this.keypair ? this.keypair.publicKey.toBase58() : '';
  }

  public getPublicKey(): PublicKey | null {
    return this.keypair ? this.keypair.publicKey : null;
  }

  public hasPrivateKey(): boolean {
    return this.keypair !== null;
  }

  /**
   * Import keypair into memory ONLY. Never written to disk.
   */
  public importPrivateKey(privateKeyInput: string): { success: boolean; message: string; publicKey?: string } {
    try {
      const decoded = decodeKeyInput(privateKeyInput);
      const kp = decoded.length === 32 ? Keypair.fromSeed(decoded) : Keypair.fromSecretKey(decoded);
      this.keypair = kp;
      const pubkey = kp.publicKey.toBase58();
      logger.info('WalletManager', `Solana wallet imported to server memory: ${pubkey}`);
      this.refreshBalance().catch(() => {});
      return {
        success: true,
        message: `Wallet imported successfully: ${pubkey}`,
        publicKey: pubkey,
      };
    } catch (err: any) {
      logger.error('WalletManager', 'Failed to import private key (invalid format)');
      return {
        success: false,
        message: 'Invalid private key format. Provide a valid Base58 string or byte array [1,2,3...].',
      };
    }
  }

  /**
   * Refreshes on-chain SOL balance with error handling
   */
  public async refreshBalance(): Promise<number> {
    if (!this.keypair) {
      this.cachedBalanceSol = 0;
      return 0;
    }

    try {
      const lamports = await this.connection.getBalance(this.keypair.publicKey, 'confirmed');
      this.cachedBalanceSol = lamports / 1e9;
      this.lastBalanceCheck = Date.now();
      this.isRpcHealthy = true;
      return this.cachedBalanceSol;
    } catch (err: any) {
      this.isRpcHealthy = false;
      logger.warn('WalletManager', `Failed to query SOL balance from RPC (${this.currentRpcUrl}): ${err.message}`);
      return this.cachedBalanceSol;
    }
  }

  public getCachedBalance(): number {
    // If balance is older than 30s, trigger async background refresh
    if (Date.now() - this.lastBalanceCheck > 30_000) {
      this.refreshBalance().catch(() => {});
    }
    return this.cachedBalanceSol;
  }

  public getStatus(): SafeWalletStatus {
    return {
      publicKey: this.getPublicKeyString(),
      balanceSol: this.getCachedBalance(),
      isConfigured: this.hasPrivateKey(),
      rpcHealthy: this.isRpcHealthy,
      rpcUrl: this.currentRpcUrl,
    };
  }

  /**
   * Sign transaction in memory.
   */
  public signTransaction(tx: VersionedTransaction): void {
    if (!this.keypair) {
      throw new Error('Cannot sign transaction: No live wallet configured in server memory.');
    }
    tx.sign([this.keypair]);
  }
}
