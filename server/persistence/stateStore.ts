import fs from 'fs';
import path from 'path';
import { ActivePosition, SniperConfig, TelegramCall, TradeHistoryItem } from '../../src/types';
import { logger } from '../logger';

// Store runtime state in runtime/state/ (or fallback server/data if mounted)
const RUNTIME_DIR = process.env.RUNTIME_DIR || path.join(process.cwd(), 'runtime', 'state');

export interface StoredSecurityConfig {
  enabled: boolean;
  codeHash?: string;
  salt?: string;
  autoLockMinutes: number;
  savedAt: number;
}

export interface StoredTelegramSession {
  sessionString: string;
  phone?: string;
  apiId?: number;
  apiHash?: string;
  username?: string;
  savedAt: number;
}

export class StateStore {
  private baseDir: string;
  private stateFilePath: string;
  private configFilePath: string;
  private securityFilePath: string;
  private processedPostsFilePath: string;
  private callsFilePath: string;
  private sessionFilePath: string;

  constructor(baseDir: string = RUNTIME_DIR) {
    this.baseDir = baseDir;
    this.ensureDirectory(this.baseDir);
    this.stateFilePath = path.join(this.baseDir, 'sniper-state.json');
    this.configFilePath = path.join(this.baseDir, 'sniper-config.json');
    this.securityFilePath = path.join(this.baseDir, 'security-config.json');
    this.processedPostsFilePath = path.join(this.baseDir, 'processed-posts.json');
    this.callsFilePath = path.join(this.baseDir, 'telegram-calls.json');
    this.sessionFilePath = path.join(this.baseDir, 'telegram-session.json');
  }

  private ensureDirectory(dir: string): void {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err) {
      logger.error('StateStore', `Failed to create directory ${dir}:`, err);
    }
  }

  /**
   * Atomic file write using a temporary file and rename to avoid corrupting state
   */
  private atomicWriteJson(filePath: string, data: any): void {
    this.ensureDirectory(path.dirname(filePath));
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    try {
      const serialized = JSON.stringify(data, null, 2);
      fs.writeFileSync(tmpPath, serialized, 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      logger.error('StateStore', `Failed atomic write to ${filePath}:`, err);
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {}
    }
  }

  private readJson<T>(filePath: string): T | null {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
      }
    } catch (err) {
      logger.warn('StateStore', `Could not read ${filePath}, returning null:`, err);
    }
    return null;
  }

  // --- POSITIONS & TRADE STATE ---

  public loadPositionsAndTrades(): { activePositions: ActivePosition[]; tradeHistory: TradeHistoryItem[] } {
    const data = this.readJson<{ activePositions: ActivePosition[]; tradeHistory: TradeHistoryItem[] }>(
      this.stateFilePath
    );
    return {
      activePositions: Array.isArray(data?.activePositions) ? data.activePositions : [],
      tradeHistory: Array.isArray(data?.tradeHistory) ? data.tradeHistory : [],
    };
  }

  public savePositionsAndTrades(activePositions: ActivePosition[], tradeHistory: TradeHistoryItem[]): void {
    this.atomicWriteJson(this.stateFilePath, {
      activePositions,
      tradeHistory,
      savedAt: Date.now(),
    });
  }

  // --- TRADING CONFIGURATION (NON-SENSITIVE) ---

  public loadSniperConfig(): Partial<SniperConfig> | null {
    const data = this.readJson<{ config: Partial<SniperConfig> }>(this.configFilePath);
    if (data?.config && typeof data.config === 'object') {
      // Security: Strip any accidentally stored privateKey fields
      const cleaned = { ...data.config };
      delete (cleaned as any).privateKeyRaw;
      delete (cleaned as any).privateKey;
      return cleaned;
    }
    return null;
  }

  public saveSniperConfig(config: Partial<SniperConfig>): void {
    // Security: strictly ensure NO private key is ever persisted in this file
    const safeConfig = { ...config };
    delete (safeConfig as any).privateKeyRaw;
    delete (safeConfig as any).privateKey;

    this.atomicWriteJson(this.configFilePath, {
      config: safeConfig,
      savedAt: Date.now(),
    });
  }

  // --- SECURITY / AUTH CONFIGURATION ---

  public loadSecurityConfig(): StoredSecurityConfig | null {
    return this.readJson<StoredSecurityConfig>(this.securityFilePath);
  }

  public saveSecurityConfig(secConfig: StoredSecurityConfig): void {
    this.atomicWriteJson(this.securityFilePath, secConfig);
  }

  // --- TELEGRAM PROCESSED POSTS DEDUPLICATION ---

  public loadProcessedPostIds(): Set<string> {
    const arr = this.readJson<string[]>(this.processedPostsFilePath);
    if (Array.isArray(arr)) {
      // Bound to last 2000 items to avoid infinite disk growth
      return new Set(arr.slice(-2000));
    }
    return new Set<string>();
  }

  public saveProcessedPostIds(ids: Set<string>): void {
    const arr = Array.from(ids).slice(-2000);
    this.atomicWriteJson(this.processedPostsFilePath, arr);
  }

  // --- TELEGRAM CALLS PERSISTENCE ---

  public loadTelegramCalls(): TelegramCall[] {
    const data = this.readJson<TelegramCall[]>(this.callsFilePath);
    return Array.isArray(data) ? data.slice(0, 100) : [];
  }

  public saveTelegramCalls(calls: TelegramCall[]): void {
    const bounded = calls.slice(0, 100);
    this.atomicWriteJson(this.callsFilePath, bounded);
  }

  // --- TELEGRAM ACCOUNT SESSION PERSISTENCE ---

  public loadTelegramSession(): StoredTelegramSession | null {
    return this.readJson<StoredTelegramSession>(this.sessionFilePath);
  }

  public saveTelegramSession(data: StoredTelegramSession): void {
    this.atomicWriteJson(this.sessionFilePath, data);
  }

  public clearTelegramSession(): void {
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        fs.unlinkSync(this.sessionFilePath);
      }
    } catch {}
  }
}
