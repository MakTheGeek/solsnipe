import { config } from './config';
import { logger } from './logger';

export interface RiskValidationResult {
  approved: boolean;
  reasons: string[];
}

export interface RiskStatus {
  circuitBreakerTripped: boolean;
  circuitBreakerReason?: string;
  liveTradingEnabled: boolean;
  currentOpenPositions: number;
  totalExposureSol: number;
  dailyLossSol: number;
  tradesInLastHour: number;
  consecutiveFailures: number;
}

export class RiskManager {
  private circuitBreakerTripped: boolean = false;
  private circuitBreakerReason?: string;
  private consecutiveFailures: number = 0;
  private dailyLossSol: number = 0;
  private dailyPnlResetTime: number = Date.now();
  private recentTradeTimestamps: number[] = [];

  constructor() {
    logger.info(
      'RiskManager',
      `RiskManager initialized. Live trading enabled server switch: ${config.LIVE_TRADING_ENABLED}, Max Position: ${config.MAX_POSITION_SIZE_SOL} SOL, Max Daily Loss: ${config.MAX_DAILY_LOSS_SOL} SOL, Max Open: ${config.MAX_OPEN_POSITIONS}`
    );
  }

  private resetDailyStatsIfNeeded(): void {
    const now = Date.now();
    // Reset every 24 hours
    if (now - this.dailyPnlResetTime > 24 * 3600_000) {
      this.dailyLossSol = 0;
      this.dailyPnlResetTime = now;
      logger.info('RiskManager', 'Daily PnL and trade risk counters reset for new 24h window');
    }

    // Clean up timestamps older than 1 hour
    const oneHourAgo = now - 3600_000;
    this.recentTradeTimestamps = this.recentTradeTimestamps.filter((t) => t > oneHourAgo);
  }

  public recordTradeClosed(pnlSol: number): void {
    this.resetDailyStatsIfNeeded();
    if (pnlSol < 0) {
      this.dailyLossSol += Math.abs(pnlSol);
      if (this.dailyLossSol >= config.MAX_DAILY_LOSS_SOL) {
        this.tripCircuitBreaker(
          `Daily loss limit exceeded (${this.dailyLossSol.toFixed(3)} SOL >= limit ${config.MAX_DAILY_LOSS_SOL} SOL)`
        );
      }
    }
  }

  public recordExecutionFailure(reason: string): void {
    this.consecutiveFailures += 1;
    logger.warn('RiskManager', `Execution failure recorded (${this.consecutiveFailures} consecutive): ${reason}`);
    if (this.consecutiveFailures >= 4) {
      this.tripCircuitBreaker(`4 consecutive transaction execution failures detected: ${reason}`);
    }
  }

  public recordExecutionSuccess(): void {
    this.consecutiveFailures = 0;
    this.recentTradeTimestamps.push(Date.now());
  }

  public tripCircuitBreaker(reason: string): void {
    this.circuitBreakerTripped = true;
    this.circuitBreakerReason = reason;
    logger.error('RiskManager', `🚨 CIRCUIT BREAKER TRIPPED: ${reason}. New entries are blocked.`);
  }

  public resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.circuitBreakerReason = undefined;
    this.consecutiveFailures = 0;
    logger.info('RiskManager', 'Circuit breaker reset manually by operator.');
  }

  public validateEntry(params: {
    isLive: boolean;
    amountSol: number;
    slippagePercent: number;
    currentOpenPositionsCount: number;
    currentTotalExposureSol: number;
    walletBalanceSol?: number;
  }): RiskValidationResult {
    this.resetDailyStatsIfNeeded();
    const reasons: string[] = [];

    // 1. Circuit breaker check
    if (this.circuitBreakerTripped) {
      reasons.push(`circuit_breaker_active: ${this.circuitBreakerReason || 'Emergency stop triggered'}`);
    }

    // Direct Daily Loss Limit check (cannot be bypassed even if circuit breaker is manually reset)
    if (this.dailyLossSol >= config.MAX_DAILY_LOSS_SOL) {
      reasons.push(
        `max_daily_loss_exceeded: Daily loss (${this.dailyLossSol.toFixed(3)} SOL) reached or exceeded limit of ${config.MAX_DAILY_LOSS_SOL} SOL`
      );
    }

    // 2. Live trading gate
    if (params.isLive) {
      if (!config.LIVE_TRADING_ENABLED) {
        reasons.push(
          'live_trading_disabled_by_server: Server environment LIVE_TRADING_ENABLED is false. Only simulation allowed.'
        );
      }
      if (params.walletBalanceSol !== undefined && params.walletBalanceSol < params.amountSol + 0.01) {
        reasons.push(
          `insufficient_wallet_balance: Wallet balance (${params.walletBalanceSol.toFixed(3)} SOL) cannot cover entry (${params.amountSol} SOL) + gas buffer (0.01 SOL)`
        );
      }
    }

    // 3. Position size limit
    if (params.amountSol > config.MAX_POSITION_SIZE_SOL) {
      reasons.push(
        `max_position_size_exceeded: Requested ${params.amountSol} SOL exceeds server limit of ${config.MAX_POSITION_SIZE_SOL} SOL`
      );
    }

    // 4. Max concurrent open positions
    if (params.currentOpenPositionsCount >= config.MAX_OPEN_POSITIONS) {
      reasons.push(
        `max_open_positions_reached: Currently ${params.currentOpenPositionsCount} positions open (limit ${config.MAX_OPEN_POSITIONS})`
      );
    }

    // 5. Total exposure
    if (params.currentTotalExposureSol + params.amountSol > config.MAX_TOTAL_EXPOSURE_SOL) {
      reasons.push(
        `max_total_exposure_exceeded: Proposed exposure ${(params.currentTotalExposureSol + params.amountSol).toFixed(2)} SOL exceeds limit of ${config.MAX_TOTAL_EXPOSURE_SOL} SOL`
      );
    }

    // 6. Max trades per hour
    if (this.recentTradeTimestamps.length >= config.MAX_TRADES_PER_HOUR) {
      reasons.push(
        `max_hourly_trades_exceeded: ${this.recentTradeTimestamps.length} trades in past hour (limit ${config.MAX_TRADES_PER_HOUR})`
      );
    }

    // 7. Slippage limit
    const slippageBps = Math.floor(params.slippagePercent * 100);
    if (slippageBps > config.MAX_SLIPPAGE_BPS) {
      reasons.push(
        `max_slippage_exceeded: Slippage ${params.slippagePercent}% (${slippageBps} bps) exceeds server max of ${config.MAX_SLIPPAGE_BPS} bps`
      );
    }

    return {
      approved: reasons.length === 0,
      reasons,
    };
  }

  public getStatus(currentOpenCount: number = 0, currentExposure: number = 0): RiskStatus {
    this.resetDailyStatsIfNeeded();
    return {
      circuitBreakerTripped: this.circuitBreakerTripped,
      circuitBreakerReason: this.circuitBreakerReason,
      liveTradingEnabled: config.LIVE_TRADING_ENABLED,
      currentOpenPositions: currentOpenCount,
      totalExposureSol: currentExposure,
      dailyLossSol: this.dailyLossSol,
      tradesInLastHour: this.recentTradeTimestamps.length,
      consecutiveFailures: this.consecutiveFailures,
    };
  }
}
