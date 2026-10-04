import { logger } from './logger';

export class IdempotencyManager {
  private activeLocks = new Map<string, { acquiredAt: number; expiresAt: number; owner: string }>();
  private processedSignals = new Map<string, number>();

  /**
   * Acquire a lock for an operation (e.g. `buy:${tokenMint}` or `sell:${positionId}`)
   */
  public acquireLock(key: string, ttlMs: number = 30_000, owner: string = 'sniper'): boolean {
    const now = Date.now();
    const existing = this.activeLocks.get(key);

    if (existing && existing.expiresAt > now) {
      logger.warn('Idempotency', `Lock acquisition REJECTED for key '${key}' (already locked by ${existing.owner})`);
      return false;
    }

    this.activeLocks.set(key, {
      acquiredAt: now,
      expiresAt: now + ttlMs,
      owner,
    });
    return true;
  }

  /**
   * Release a lock once operation completes
   */
  public releaseLock(key: string): void {
    this.activeLocks.delete(key);
  }

  /**
   * Check if a signal/post has already been executed to prevent duplicate snipes
   */
  public hasSignalBeenProcessed(signalKey: string): boolean {
    const processedAt = this.processedSignals.get(signalKey);
    if (!processedAt) return false;

    // Retain processed signal memory for 6 hours
    if (Date.now() - processedAt > 6 * 3600_000) {
      this.processedSignals.delete(signalKey);
      return false;
    }

    return true;
  }

  /**
   * Mark signal as executed
   */
  public markSignalProcessed(signalKey: string): void {
    this.processedSignals.set(signalKey, Date.now());

    // Bound memory size to 5000 items
    if (this.processedSignals.size > 5000) {
      const now = Date.now();
      for (const [k, v] of this.processedSignals.entries()) {
        if (now - v > 6 * 3600_000) {
          this.processedSignals.delete(k);
        }
      }
    }
  }

  public cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.activeLocks.entries()) {
      if (v.expiresAt <= now) {
        this.activeLocks.delete(k);
      }
    }
  }
}
