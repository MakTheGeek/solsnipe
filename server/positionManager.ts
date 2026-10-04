import { ActivePosition, TradeHistoryItem } from '../src/types';
import { config } from './config';
import { DexscreenerClient, DexscreenerPair } from './dexscreener';
import { JupiterRouter } from './execution/jupiterRouter';
import { SimulationRouter } from './execution/simulationRouter';
import { IdempotencyManager } from './idempotency';
import { logger } from './logger';
import { StateStore } from './persistence/stateStore';
import { RiskManager } from './riskManager';
import { WalletManager } from './walletManager';

export class PositionManager {
  private activePositions = new Map<string, ActivePosition>();
  private tradeHistory: TradeHistoryItem[] = [];
  private dexscreener: DexscreenerClient;
  private simulationRouter: SimulationRouter;
  private jupiterRouter: JupiterRouter;
  private walletManager: WalletManager;
  private riskManager: RiskManager;
  private idempotency: IdempotencyManager;
  private stateStore: StateStore;
  private trackingInterval: NodeJS.Timeout | null = null;
  private isTracking = false;
  private onPositionUpdate?: (positions: ActivePosition[]) => void;
  private onTradeExecuted?: (trade: TradeHistoryItem) => void;

  constructor(params: {
    dexscreener: DexscreenerClient;
    simulationRouter: SimulationRouter;
    jupiterRouter: JupiterRouter;
    walletManager: WalletManager;
    riskManager: RiskManager;
    idempotency: IdempotencyManager;
    stateStore: StateStore;
  }) {
    this.dexscreener = params.dexscreener;
    this.simulationRouter = params.simulationRouter;
    this.jupiterRouter = params.jupiterRouter;
    this.walletManager = params.walletManager;
    this.riskManager = params.riskManager;
    this.idempotency = params.idempotency;
    this.stateStore = params.stateStore;

    // Restore state from disk
    const saved = this.stateStore.loadPositionsAndTrades();
    if (saved.activePositions.length > 0) {
      for (const pos of saved.activePositions) {
        if (pos.status === 'OPEN' || (pos.status as any) === 'active' || (pos.status as any) === 'partial_sold') {
          // Normalize status
          pos.status = 'OPEN';
          this.activePositions.set(pos.id, pos);
        }
      }
      logger.info('PositionManager', `Restored ${this.activePositions.size} open positions from persistence.`);
    }

    if (saved.tradeHistory.length > 0) {
      this.tradeHistory = saved.tradeHistory.slice(-200);
      logger.info('PositionManager', `Restored ${this.tradeHistory.length} historical trades from persistence.`);
    }

    this.startPriceTracker();
  }

  public setCallbacks(
    onPositionUpdate: (positions: ActivePosition[]) => void,
    onTradeExecuted: (trade: TradeHistoryItem) => void
  ): void {
    this.onPositionUpdate = onPositionUpdate;
    this.onTradeExecuted = onTradeExecuted;
  }

  public getActivePositions(): ActivePosition[] {
    return Array.from(this.activePositions.values());
  }

  public getTradeHistory(): TradeHistoryItem[] {
    return this.tradeHistory;
  }

  public addPosition(position: ActivePosition): void {
    this.activePositions.set(position.id, position);
    this.saveState();
    if (this.onPositionUpdate) {
      this.onPositionUpdate(this.getActivePositions());
    }
  }

  public saveState(): void {
    this.stateStore.savePositionsAndTrades(this.getActivePositions(), this.tradeHistory);
  }

  private startPriceTracker(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
    }

    this.trackingInterval = setInterval(() => {
      this.trackPricesAndExits().catch((err) => {
        logger.error('PositionManager', 'Error in position tracking loop:', err);
      });
    }, 2000);
    this.trackingInterval.unref?.();
  }

  public stopPriceTracker(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
  }

  /**
   * Price tracking loop: fetches batch prices and evaluates TP, SL, Trailing, Stagnation
   */
  public async trackPricesAndExits(): Promise<void> {
    if (this.isTracking) return;
    this.isTracking = true;

    try {
      const positions = this.getActivePositions().filter((p) => p.status === 'OPEN');
      if (positions.length === 0) return;

      const addresses = positions.map((p) => p.tokenAddress);
      const hints = new Map<string, { pairAddress?: string; dexId?: string }>();
      for (const p of positions) {
        hints.set(p.tokenAddress, { pairAddress: p.pairAddress, dexId: p.dexId });
      }

      const pricePairs = await this.dexscreener.getBatchTokenPairs(addresses, hints);
      const solPriceUsd = await this.dexscreener.getSolPriceUsd();
      let hasUpdates = false;

      for (const pos of positions) {
        const pair = pricePairs.get(pos.tokenAddress);
        if (!pair) continue;

        const currentPriceUsd = Number(pair.priceUsd);
        if (currentPriceUsd <= 0) continue;

        // Update position metrics
        pos.currentPriceUsd = currentPriceUsd;
        pos.currentPriceSol = solPriceUsd > 0 ? currentPriceUsd / solPriceUsd : 0;
        pos.lastUpdated = Date.now();

        // Peak price tracking for trailing stop
        if (currentPriceUsd > (pos.peakPriceUsd || pos.entryPriceUsd)) {
          pos.peakPriceUsd = currentPriceUsd;
          if (pos.trailingStopPercent > 0) {
            pos.trailingStopPriceUsd = pos.peakPriceUsd * (1 - pos.trailingStopPercent / 100);
          }
        }

        // Unrealized PnL
        const pnlPct = ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        pos.pnlPercent = pnlPct;
        pos.pnlUsd = (pos.amountSol * solPriceUsd * pnlPct) / 100;
        pos.pnlSol = (pos.amountSol * pnlPct) / 100;

        // Detect price movement for stagnation check
        const lastRecorded = pos.lastRecordedPriceUsd || pos.entryPriceUsd;
        const priceDeltaPct = Math.abs(((currentPriceUsd - lastRecorded) / lastRecorded) * 100);
        const thresholdPct = pos.stagnantThresholdPercent ?? 1.0;

        if (priceDeltaPct >= thresholdPct) {
          pos.lastRecordedPriceUsd = currentPriceUsd;
          pos.lastPriceMovementAt = Date.now();
        }

        hasUpdates = true;

        // Check exit conditions
        await this.evaluateExitConditions(pos, currentPriceUsd, solPriceUsd);
      }

      if (hasUpdates) {
        this.saveState();
        if (this.onPositionUpdate) {
          this.onPositionUpdate(this.getActivePositions());
        }
      }
    } finally {
      this.isTracking = false;
    }
  }

  private async evaluateExitConditions(pos: ActivePosition, currentPriceUsd: number, solPriceUsd: number): Promise<void> {
    // 1. Take Profit
    if (pos.tpPercent > 0 && currentPriceUsd >= pos.tpPriceUsd) {
      logger.info('PositionManager', `🎯 TAKE PROFIT HIT for ${pos.tokenSymbol} (+${pos.pnlPercent.toFixed(2)}%)`);
      await this.executeSell(pos.id, 100, 'tp');
      return;
    }

    // 2. Stop Loss
    if (pos.slPercent > 0 && currentPriceUsd <= pos.slPriceUsd) {
      logger.info('PositionManager', `🛑 STOP LOSS HIT for ${pos.tokenSymbol} (${pos.pnlPercent.toFixed(2)}%)`);
      await this.executeSell(pos.id, 100, 'sl');
      return;
    }

    // 3. Trailing Stop
    if (
      pos.trailingStopPercent > 0 &&
      pos.peakPriceUsd > pos.entryPriceUsd * 1.05 && // Activated after at least 5% gain
      pos.trailingStopPriceUsd > 0 &&
      currentPriceUsd <= pos.trailingStopPriceUsd
    ) {
      logger.info('PositionManager', `📉 TRAILING STOP HIT for ${pos.tokenSymbol} (Peak: $${pos.peakPriceUsd}, Price: $${currentPriceUsd})`);
      await this.executeSell(pos.id, 100, 'trailing');
      return;
    }

    // 4. Stagnation Auto-Sell
    if (pos.autoSellStagnant && pos.stagnantTimeoutSeconds && pos.stagnantTimeoutSeconds > 0) {
      const lastMove = pos.lastPriceMovementAt || pos.openedAt;
      const stagnantSeconds = (Date.now() - lastMove) / 1000;
      if (stagnantSeconds >= pos.stagnantTimeoutSeconds) {
        logger.info(
          'PositionManager',
          `⏳ STAGNATION EXIT for ${pos.tokenSymbol}: No significant price movement for ${Math.round(stagnantSeconds)}s`
        );
        await this.executeSell(pos.id, 100, 'stagnant');
        return;
      }
    }
  }

  /**
   * Executes a sell order with strict idempotency and lock protection
   */
  public async executeSell(
    positionId: string,
    percent: number = 100,
    exitReason: 'tp' | 'sl' | 'trailing' | 'stagnant' | 'manual' | string = 'manual',
    overridePriceUsd?: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const lockKey = `sell:${positionId}`;
    if (!this.idempotency.acquireLock(lockKey, 30_000, `sell_${exitReason}`)) {
      return { success: false, error: 'SELL_IN_PROGRESS: Another sell operation is already active for this position' };
    }

    try {
      const pos = this.activePositions.get(positionId);
      if (!pos || pos.status === 'CLOSED') {
        return { success: false, error: 'POSITION_NOT_FOUND_OR_CLOSED: Position is not active' };
      }

      if (pos.executionMode === 'wallet' && !config.LIVE_TRADING_ENABLED) {
        logger.warn('PositionManager', 'Live sell blocked: LIVE_TRADING_ENABLED is false on server.');
        return {
          success: false,
          error: 'LIVE_TRADING_DISABLED: Server environment LIVE_TRADING_ENABLED is false. On-chain sell blocked.',
        };
      }

      const solPriceUsd = await this.dexscreener.getSolPriceUsd();
      const currentPriceUsd =
        overridePriceUsd && overridePriceUsd > 0
          ? overridePriceUsd
          : pos.currentPriceUsd > 0
          ? pos.currentPriceUsd
          : pos.entryPriceUsd;

      if (pos.executionMode === 'simulation') {
        // Simulation sell
        const result = this.simulationRouter.executeSimulatedSell(
          pos,
          currentPriceUsd,
          percent,
          exitReason,
          solPriceUsd
        );

        this.tradeHistory.unshift(result.trade);
        this.riskManager.recordTradeClosed(result.trade.pnlSol || 0);

        if (percent >= 100 || result.position.status === 'CLOSED') {
          pos.status = 'CLOSED';
          pos.closedAt = Date.now();
          pos.exitReason = exitReason;
          this.activePositions.delete(positionId);
        } else {
          this.activePositions.set(positionId, result.position);
        }

        this.saveState();
        if (this.onTradeExecuted) this.onTradeExecuted(result.trade);
        if (this.onPositionUpdate) this.onPositionUpdate(this.getActivePositions());

        return { success: true, txHash: result.trade.txHash };
      } else {
        // Live On-Chain Sell via Jupiter
        const swapResult = await this.jupiterRouter.executeLiveSell(pos.tokenAddress, percent, 5);
        if (!swapResult.success) {
          this.riskManager.recordExecutionFailure(swapResult.error || 'Live sell failed');
          return { success: false, error: swapResult.error };
        }

        this.riskManager.recordExecutionSuccess();

        // Calculate real trade metrics for sold portion
        const soldSol = (pos.amountSol * percent) / 100;
        const pnlPct = ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
        const pnlSol = (soldSol * pnlPct) / 100;
        const pnlUsd = (soldSol * solPriceUsd * pnlPct) / 100;

        const trade: TradeHistoryItem = {
          id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          tokenAddress: pos.tokenAddress,
          tokenSymbol: pos.tokenSymbol,
          buyPriceUsd: pos.entryPriceUsd,
          sellPriceUsd: currentPriceUsd,
          amountSol: soldSol,
          realizedPnlUsd: pnlUsd,
          realizedPnlPercent: pnlPct,
          realizedPnlSol: pnlSol,
          openedAt: pos.openedAt,
          closedAt: Date.now(),
          exitReason,
          router: 'jupiter',
          executionMode: 'wallet',
          txHash: swapResult.txHash,
        };

        this.tradeHistory.unshift(trade);
        this.riskManager.recordTradeClosed(pnlSol);

        if (percent >= 100) {
          pos.status = 'CLOSED';
          pos.closedAt = Date.now();
          pos.exitReason = exitReason;
          pos.txHash = swapResult.txHash;
          this.activePositions.delete(positionId);
        } else {
          pos.amountSol = Math.max(0, pos.amountSol - soldSol);
          pos.amountTokens = Math.max(0, pos.amountTokens * (1 - percent / 100));
          pos.lastUpdated = Date.now();
          this.activePositions.set(positionId, pos);
        }

        this.saveState();
        if (this.onTradeExecuted) this.onTradeExecuted(trade);
        if (this.onPositionUpdate) this.onPositionUpdate(this.getActivePositions());

        return { success: true, txHash: swapResult.txHash };
      }
    } finally {
      this.idempotency.releaseLock(lockKey);
    }
  }

  public updateTargets(
    positionId: string,
    targets: {
      tpPercent?: number;
      slPercent?: number;
      trailingStopPercent?: number;
      autoSellStagnant?: boolean;
      stagnantTimeoutSeconds?: number;
    }
  ): ActivePosition | null {
    const pos = this.activePositions.get(positionId);
    if (!pos || pos.status === 'CLOSED') return null;

    if (targets.tpPercent !== undefined) {
      pos.tpPercent = Math.max(0, targets.tpPercent);
      pos.tpPriceUsd = pos.tpPercent > 0 ? pos.entryPriceUsd * (1 + pos.tpPercent / 100) : Infinity;
    }
    if (targets.slPercent !== undefined) {
      pos.slPercent = Math.max(0, targets.slPercent);
      pos.slPriceUsd = pos.slPercent > 0 ? pos.entryPriceUsd * (1 - pos.slPercent / 100) : 0;
    }
    if (targets.trailingStopPercent !== undefined) {
      pos.trailingStopPercent = Math.max(0, targets.trailingStopPercent);
      pos.trailingStopPriceUsd =
        pos.trailingStopPercent > 0 ? (pos.peakPriceUsd || pos.entryPriceUsd) * (1 - pos.trailingStopPercent / 100) : 0;
    }
    if (targets.autoSellStagnant !== undefined) {
      pos.autoSellStagnant = targets.autoSellStagnant;
    }
    if (targets.stagnantTimeoutSeconds !== undefined) {
      pos.stagnantTimeoutSeconds = Math.max(10, targets.stagnantTimeoutSeconds);
    }

    pos.lastUpdated = Date.now();
    this.saveState();
    if (this.onPositionUpdate) {
      this.onPositionUpdate(this.getActivePositions());
    }
    return pos;
  }
}
