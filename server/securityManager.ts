import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { logger } from './logger';
import { StateStore, StoredSecurityConfig } from './persistence/stateStore';

export interface SecurityStatus {
  enabled: boolean;
  hasCodeSet: boolean;
  autoLockMinutes: number;
}

interface ActiveSession {
  token: string;
  createdAt: number;
  lastActiveAt: number;
}

export class SecurityManager {
  private config: StoredSecurityConfig = {
    enabled: false,
    autoLockMinutes: config.AUTO_LOCK_MINUTES,
    savedAt: Date.now(),
  };

  private activeSessions = new Map<string, ActiveSession>();
  private failedAttempts = 0;
  private lockedUntil = 0;
  private stateStore: StateStore;

  constructor(stateStore: StateStore) {
    this.stateStore = stateStore;
    this.loadConfig();

    // If ADMIN_PASSWORD env var is supplied and no code is configured on disk, initialize it automatically
    if (config.ADMIN_PASSWORD && !this.config.codeHash) {
      logger.info('SecurityManager', 'Initializing admin authentication from ADMIN_PASSWORD env var');
      this.setupCode({ newCode: config.ADMIN_PASSWORD, autoLockMinutes: config.AUTO_LOCK_MINUTES });
    }
  }

  private loadConfig(): void {
    const loaded = this.stateStore.loadSecurityConfig();
    if (loaded && typeof loaded === 'object') {
      this.config = {
        enabled: Boolean(loaded.enabled),
        codeHash: loaded.codeHash || undefined,
        salt: loaded.salt || undefined,
        autoLockMinutes: typeof loaded.autoLockMinutes === 'number' ? loaded.autoLockMinutes : 30,
        savedAt: loaded.savedAt || Date.now(),
      };
      logger.info(
        'SecurityManager',
        `Security configuration loaded. Code set: ${Boolean(this.config.codeHash)}, Enabled: ${this.config.enabled}`
      );
    }
  }

  private saveConfig(): void {
    this.config.savedAt = Date.now();
    this.stateStore.saveSecurityConfig(this.config);
  }

  /**
   * Secure constant-time password hash using SHA-256 HMAC and salt
   */
  private hashWithSalt(code: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(code.trim()).digest('hex');
  }

  /**
   * Constant-time string comparison to defend against timing attacks
   */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  public getStatus(): SecurityStatus {
    return {
      enabled: Boolean(this.config.enabled && this.config.codeHash),
      hasCodeSet: Boolean(this.config.codeHash),
      autoLockMinutes: this.config.autoLockMinutes,
    };
  }

  public generateSessionToken(): string {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.activeSessions.set(token, {
      token,
      createdAt: now,
      lastActiveAt: now,
    });

    // Cleanup expired sessions or cap size to 200
    if (this.activeSessions.size > 200) {
      const entries = Array.from(this.activeSessions.entries());
      const cutoff = now - (this.config.autoLockMinutes > 0 ? this.config.autoLockMinutes * 60_000 : 24 * 3600_000);
      for (const [k, v] of entries) {
        if (v.lastActiveAt < cutoff) {
          this.activeSessions.delete(k);
        }
      }
    }

    return token;
  }

  public invalidateSession(token: string): void {
    if (token) {
      this.activeSessions.delete(token);
    }
  }

  public isTokenValid(token?: string): boolean {
    // If no password or security code is configured, deny access (setup required)
    if (!this.config.codeHash || !this.config.salt) {
      return false;
    }

    if (!token) return false;

    const session = this.activeSessions.get(token);
    if (!session) return false;

    const now = Date.now();
    if (this.config.autoLockMinutes > 0) {
      const maxAgeMs = this.config.autoLockMinutes * 60_000;
      if (now - session.lastActiveAt > maxAgeMs) {
        this.activeSessions.delete(token);
        logger.info('SecurityManager', 'Session expired due to inactivity');
        return false;
      }
    }

    // Refresh last active timestamp (sliding window)
    session.lastActiveAt = now;
    return true;
  }

  /**
   * Express middleware to enforce authentication
   */
  public requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    // If security is not yet initialized with a code, allow read-only GET requests, block mutations
    if (!this.config.codeHash || !this.config.salt) {
      if (req.method === 'GET') {
        next();
        return;
      }
      res.status(403).json({
        success: false,
        error: {
          code: 'SECURITY_SETUP_REQUIRED',
          message: 'Security setup required. Please configure an admin password before accessing the system.',
        },
      });
      return;
    }

    // Check Authorization header or cookie
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.cookies && req.cookies['solsnipe_session']) {
      token = req.cookies['solsnipe_session'];
    }

    if (!this.isTokenValid(token)) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please unlock the dashboard with your security PIN/password.',
        },
      });
      return;
    }

    next();
  };

  private recordFailedAttempt(): { remaining: number; locked: boolean; waitSeconds?: number } {
    const now = Date.now();
    this.failedAttempts += 1;
    if (this.failedAttempts >= 5) {
      this.lockedUntil = now + 30000; // 30-sec lockout
      this.failedAttempts = 0;
      logger.warn('SecurityManager', '5 failed authentication attempts: Locking out for 30s');
      return { remaining: 0, locked: true, waitSeconds: 30 };
    }
    const remaining = 5 - this.failedAttempts;
    logger.warn('SecurityManager', `Incorrect authentication attempt (${remaining} attempts remaining)`);
    return { remaining, locked: false };
  }

  /**
   * Verify password / PIN with brute-force lockout
   */
  public verifyCode(code: string): { success: boolean; token?: string; message: string; remainingAttempts?: number } {
    if (!this.config.codeHash || !this.config.salt) {
      return { success: false, message: 'Authentication is not configured. Please set up a security code first.' };
    }

    const now = Date.now();
    if (this.lockedUntil > now) {
      const waitSeconds = Math.ceil((this.lockedUntil - now) / 1000);
      return {
        success: false,
        message: `Too many failed attempts. Dashboard locked for ${waitSeconds} seconds.`,
      };
    }

    const cleanCode = (code || '').trim();
    if (!cleanCode) {
      return { success: false, message: 'Please provide authentication code' };
    }

    const checkHash = this.hashWithSalt(cleanCode, this.config.salt);
    if (this.safeCompare(checkHash, this.config.codeHash)) {
      this.failedAttempts = 0;
      this.lockedUntil = 0;
      const token = this.generateSessionToken();
      logger.info('SecurityManager', 'Successful authentication');
      return { success: true, token, message: 'Authenticated successfully' };
    }

    const fail = this.recordFailedAttempt();
    if (fail.locked) {
      return {
        success: false,
        message: '5 failed attempts. Dashboard temporarily locked for 30 seconds.',
      };
    }

    return {
      success: false,
      message: `Incorrect code (${fail.remaining} attempt${fail.remaining > 1 ? 's' : ''} remaining)`,
      remainingAttempts: fail.remaining,
    };
  }

  public setupCode(params: {
    newCode: string;
    currentCode?: string;
    autoLockMinutes?: number;
  }): { success: boolean; token?: string; message: string } {
    const now = Date.now();
    if (this.lockedUntil > now) {
      const waitSeconds = Math.ceil((this.lockedUntil - now) / 1000);
      return {
        success: false,
        message: `Too many failed attempts. Locked for ${waitSeconds} seconds.`,
      };
    }

    const { newCode, currentCode, autoLockMinutes } = params;
    const cleanNew = (newCode || '').trim();

    if (cleanNew.length < 4) {
      return {
        success: false,
        message: 'Password/code must be at least 4 characters long.',
      };
    }

    // If already configured, verify current code first with brute-force tracking
    if (this.config.codeHash && this.config.salt) {
      const cleanCurrent = (currentCode || '').trim();
      if (!cleanCurrent) {
        return {
          success: false,
          message: 'Current code is required to change security credentials.',
        };
      }
      const currentHash = this.hashWithSalt(cleanCurrent, this.config.salt);
      if (!this.safeCompare(currentHash, this.config.codeHash)) {
        this.recordFailedAttempt();
        return {
          success: false,
          message: 'Current code is incorrect.',
        };
      }
    }

    this.failedAttempts = 0;
    this.lockedUntil = 0;

    const salt = crypto.randomBytes(16).toString('hex');
    const codeHash = this.hashWithSalt(cleanNew, salt);

    this.config.salt = salt;
    this.config.codeHash = codeHash;
    this.config.enabled = true;
    if (typeof autoLockMinutes === 'number') {
      this.config.autoLockMinutes = Math.max(0, autoLockMinutes);
    }

    this.saveConfig();
    const token = this.generateSessionToken();
    logger.info('SecurityManager', 'Security code updated and enabled successfully');
    return {
      success: true,
      token,
      message: 'Security credentials configured and enabled.',
    };
  }

  public toggleProtection(enabled: boolean, currentCode: string): { success: boolean; message: string } {
    const now = Date.now();
    if (this.lockedUntil > now) {
      const waitSeconds = Math.ceil((this.lockedUntil - now) / 1000);
      return {
        success: false,
        message: `Too many failed attempts. Locked for ${waitSeconds} seconds.`,
      };
    }

    if (!this.config.codeHash || !this.config.salt) {
      return {
        success: false,
        message: 'No code configured. Please set a code first.',
      };
    }

    const cleanCurrent = (currentCode || '').trim();
    if (!cleanCurrent) {
      return {
        success: false,
        message: 'Current code is required to toggle security protection.',
      };
    }

    const currentHash = this.hashWithSalt(cleanCurrent, this.config.salt);
    if (!this.safeCompare(currentHash, this.config.codeHash)) {
      this.recordFailedAttempt();
      return {
        success: false,
        message: 'Current code is incorrect.',
      };
    }

    this.failedAttempts = 0;
    this.lockedUntil = 0;
    this.config.enabled = Boolean(enabled);
    this.saveConfig();
    return {
      success: true,
      message: enabled ? 'Security protection enabled.' : 'Security protection disabled.',
    };
  }

  public removeCode(currentCode: string): { success: boolean; message: string } {
    const now = Date.now();
    if (this.lockedUntil > now) {
      const waitSeconds = Math.ceil((this.lockedUntil - now) / 1000);
      return {
        success: false,
        message: `Too many failed attempts. Locked for ${waitSeconds} seconds.`,
      };
    }

    if (!this.config.codeHash || !this.config.salt) {
      return { success: true, message: 'No security code was configured.' };
    }

    const cleanCurrent = (currentCode || '').trim();
    const currentHash = this.hashWithSalt(cleanCurrent, this.config.salt);
    if (!this.safeCompare(currentHash, this.config.codeHash)) {
      this.recordFailedAttempt();
      return {
        success: false,
        message: 'Current code is incorrect. Cannot remove security code.',
      };
    }

    this.failedAttempts = 0;
    this.lockedUntil = 0;
    this.config.codeHash = undefined;
    this.config.salt = undefined;
    this.config.enabled = false;
    this.activeSessions.clear();
    this.saveConfig();

    return {
      success: true,
      message: 'Security protection removed successfully.',
    };
  }

  public updateAutoLock(autoLockMinutes: number): { success: boolean; message: string } {
    this.config.autoLockMinutes = Math.max(0, autoLockMinutes);
    this.saveConfig();
    return {
      success: true,
      message: `Auto-lock interval updated: ${autoLockMinutes === 0 ? 'On tab close' : `${autoLockMinutes} minutes`}.`,
    };
  }
}
