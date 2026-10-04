import {
  ActivePosition,
  DailyPerformanceStat,
  GMGNAnalysisReport,
  PerformanceStatsResponse,
  PerformanceSummary,
  SniperConfig,
  TradeHistoryItem,
} from '../src/types';
import { config } from './config';
import { DexscreenerClient } from './dexscreener';
import { JitoRouter } from './execution/jitoRouter';
import { JupiterRouter } from './execution/jupiterRouter';
import { SimulationRouter } from './execution/simulationRouter';
import { IdempotencyManager } from './idempotency';
import { logger } from './logger';
import { StateStore } from './persistence/stateStore';
import { PositionManager } from './positionManager';
import { RiskManager } from './riskManager';
import { SafeWalletStatus, WalletManager } from './walletManager';

export class SniperEngine {
  private config: SniperConfig = {
    autoSnipe: true,
    tradingAmountSol: 0.1,
    takeProfitPercent: 50,
    stopLossPercent: 15,
    trailingStopPercent: 10,
    autoSellStagnant: true,
    stagnantTimeoutSeconds: 180,
    stagnantThresholdPercent: 1.0,
    slippagePercent: 5,
    maxRugCheckScore: 800,
    rejectOnRugCheckDanger: true,
    maxEntryMarketCapUsd: 40000,
    maxTokenAgeMinutes: 15,
    requirePositiveMomentum5m: true,
    router: 'jupiter',
    executionMode: 'simulation',
    priorityFeeSol: 0.005,
    jitoTipSol: 0.005,
    walletPublicKey: '',
    hasPrivateKey: false,
    walletBalanceSol: 0,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
  };

  private dexscreener: DexscreenerClient;
  private walletManager: WalletManager;
  private riskManager: RiskManager;
  private idempotency: IdempotencyManager;
  private stateStore: StateStore;
  private simulationRouter: SimulationRouter;
  private jupiterRouter: JupiterRouter;
  private jitoRouter: JitoRouter;
  private positionManager: PositionManager;

  constructor(dexscreener: DexscreenerClient, stateStore: StateStore) {
    this.dexscreener = dexscreener;
    this.stateStore = stateStore;
    this.walletManager = new WalletManager();
    this.riskManager = new RiskManager();
    this.idempotency = new IdempotencyManager();
    this.simulationRouter = new SimulationRouter();
    this.jupiterRouter = new JupiterRouter(this.walletManager);
    this.jitoRouter = new JitoRouter(this.walletManager);

    this.positionManager = new PositionManager({
      dexscreener: this.dexscreener,
      simulationRouter: this.simulationRouter,
      jupiterRouter: this.jupiterRouter,
      walletManager: this.walletManager,
      riskManager: this.riskManager,
      idempotency: this.idempotency,
      stateStore: this.stateStore,
    });

    // Restore persistent config
    const savedConfig = this.stateStore.loadSniperConfig();
    if (savedConfig) {
      this.config = { ...this.config, ...savedConfig };
    }

    // Sync wallet status
    this.syncWalletStatus();

    logger.info(
      'SniperEngine',
      `SniperEngine initialized. Mode: ${this.config.executionMode}, Auto-Snipe: ${this.config.autoSnipe}`
    );
  }

  private syncWalletStatus(): void {
    const status = this.walletManager.getStatus();
    this.config.walletPublicKey = status.publicKey;
    this.config.hasPrivateKey = status.isConfigured;
    this.config.walletBalanceSol = status.balanceSol;
  }

  public setCallbacks(
    onPositionsUpdated: (positions: ActivePosition[]) => void,
    onTradeExecuted: (trade: TradeHistoryItem) => void
  ): void {
    this.positionManager.setCallbacks(onPositionsUpdated, onTradeExecuted);
  }

  public getConfig(): SniperConfig {
    this.syncWalletStatus();
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<SniperConfig>): SniperConfig {
    if (newConfig.rpcUrl && newConfig.rpcUrl !== this.config.rpcUrl) {
      this.walletManager.setRpcUrl(newConfig.rpcUrl);
    }

    // HARD SECURITY INVARIANT: Live trading CANNOT be enabled from frontend alone if LIVE_TRADING_ENABLED=false
    if (!config.LIVE_TRADING_ENABLED && newConfig.executionMode === 'wallet') {
      logger.warn(
        'SniperEngine',
        'SECURITY GUARD: Attempted to enable wallet execution mode from frontend while server LIVE_TRADING_ENABLED=false. Forcing simulation mode.'
      );
      newConfig.executionMode = 'simulation';
    }

    this.config = { ...this.config, ...newConfig };
    this.stateStore.saveSniperConfig(this.config);
    this.syncWalletStatus();
    logger.info('SniperEngine', 'Sniper configuration updated');
    return this.getConfig();
  }

  public getWalletManager(): WalletManager {
    return this.walletManager;
  }

  public getRiskManager(): RiskManager {
    return this.riskManager;
  }

  public getPositionManager(): PositionManager {
    return this.positionManager;
  }

  public getActivePositions(): ActivePosition[] {
    return this.positionManager.getActivePositions();
  }

  public getTradeHistory(): TradeHistoryItem[] {
    return this.positionManager.getTradeHistory();
  }

  /**
   * Refreshes wallet balance
   */
  public async refreshWalletBalance(): Promise<SafeWalletStatus> {
    await this.walletManager.refreshBalance();
    this.syncWalletStatus();
    return this.walletManager.getStatus();
  }

  /**
   * Executes a token snipe with strict idempotency and risk limit checks
   */
  public async executeSnipe(
    report: GMGNAnalysisReport,
    overrides?: { amountSol?: number; slippagePercent?: number }
  ): Promise<ActivePosition> {
    const tokenAddress = report.tokenAddress.trim();
    const lockKey = `buy:${tokenAddress}`;

    // 1. Idempotency Lock: strictly prevent buying the same token concurrently
    if (!this.idempotency.acquireLock(lockKey, 30_000, 'sniper_buy')) {
      throw new Error(`DUPLICATE_BUY_PREVENTED: A buy operation is already pending for token ${tokenAddress}`);
    }

    try {
      // Check historical idempotency memory: prevent duplicate execution for recently processed token
      if (this.idempotency.hasSignalBeenProcessed(tokenAddress)) {
        throw new Error(`DUPLICATE_BUY_PREVENTED: Token ${tokenAddress} was already executed recently`);
      }

      // Check if position already exists for this token
      const existing = this.getActivePositions().find((p) => p.tokenAddress === tokenAddress && p.status === 'OPEN');
      if (existing) {
        throw new Error(`POSITION_ALREADY_OPEN: An active position already exists for ${tokenAddress}`);
      }

      const isLive = this.config.executionMode === 'wallet';
      const amountSol = overrides?.amountSol && overrides.amountSol > 0 ? overrides.amountSol : this.config.tradingAmountSol;
      const slippagePercent =
        overrides?.slippagePercent !== undefined && overrides.slippagePercent > 0
          ? overrides.slippagePercent
          : this.config.slippagePercent;

      const currentOpen = this.getActivePositions().filter((p) => p.status === 'OPEN');
      const totalExposure = currentOpen.reduce((acc, p) => acc + p.amountSol, 0);
      const balance = this.walletManager.getCachedBalance();

      // 2. Hard Risk Validation
      const riskValidation = this.riskManager.validateEntry({
        isLive,
        amountSol,
        slippagePercent,
        currentOpenPositionsCount: currentOpen.length,
        currentTotalExposureSol: totalExposure,
        walletBalanceSol: balance,
      });

      if (!riskValidation.approved) {
        const errorMsg = `RISK_VALIDATION_REJECTED: ${riskValidation.reasons.join(', ')}`;
        logger.warn('SniperEngine', errorMsg);
        throw new Error(errorMsg);
      }

      const solPriceUsd = await this.dexscreener.getSolPriceUsd();

      if (!isLive) {
        // --- SIMULATION EXECUTION ---
        const position = this.simulationRouter.executeSimulatedBuy(
          report,
          amountSol,
          slippagePercent,
          solPriceUsd
        );

        // Apply targets from config
        position.tpPercent = this.config.takeProfitPercent;
        position.slPercent = this.config.stopLossPercent;
        position.trailingStopPercent = this.config.trailingStopPercent;
        position.tpPriceUsd = position.entryPriceUsd * (1 + position.tpPercent / 100);
        position.slPriceUsd = position.entryPriceUsd * (1 - position.slPercent / 100);
        position.trailingStopPriceUsd = position.entryPriceUsd * (1 - position.trailingStopPercent / 100);
        position.autoSellStagnant = this.config.autoSellStagnant;
        position.stagnantTimeoutSeconds = this.config.stagnantTimeoutSeconds;
        position.stagnantThresholdPercent = this.config.stagnantThresholdPercent;

        this.positionManager.addPosition(position);
        this.riskManager.recordExecutionSuccess();
        this.idempotency.markSignalProcessed(tokenAddress);
        return position;
      } else {
        // --- LIVE ON-CHAIN EXECUTION ---
        if (this.config.router === 'jito') {
          // If Jito requested, check availability
          if (!this.jitoRouter.isAvailable()) {
            throw new Error(
              'JITO_NOT_CONFIGURED: Jito Block Engine is not configured in this environment. Use Jupiter router.'
            );
          }
          throw new Error('JITO_BUNDLE_ROUTING: Jito bundle submission requires dedicated bundle assembly.');
        }

        // Live Jupiter Buy
        const swapResult = await this.jupiterRouter.executeLiveBuy(
          tokenAddress,
          amountSol,
          slippagePercent,
          this.config.priorityFeeSol
        );

        if (!swapResult.success) {
          this.riskManager.recordExecutionFailure(swapResult.error || 'Jupiter buy failed');
          throw new Error(`LIVE_BUY_FAILED: ${swapResult.error}`);
        }

        this.riskManager.recordExecutionSuccess();
        this.idempotency.markSignalProcessed(tokenAddress);

        const entryPriceUsd = report.priceUsd > 0 ? report.priceUsd : 0.00001;
        const investmentUsd = amountSol * solPriceUsd;

        const livePosition: ActivePosition = {
          id: `live_pos_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          tokenAddress,
          tokenSymbol: report.tokenSymbol || 'UNKNOWN',
          tokenName: report.tokenName || 'Unknown Token',
          entryPriceUsd,
          entryPriceSol: solPriceUsd > 0 ? entryPriceUsd / solPriceUsd : 0,
          currentPriceUsd: entryPriceUsd,
          currentPriceSol: solPriceUsd > 0 ? entryPriceUsd / solPriceUsd : 0,
          peakPriceUsd: entryPriceUsd,
          amountSol,
          amountTokens: swapResult.outAmountRaw ? Number(swapResult.outAmountRaw) : 0,
          pnlUsd: 0,
          pnlSol: 0,
          pnlPercent: 0,
          tpPercent: this.config.takeProfitPercent,
          slPercent: this.config.stopLossPercent,
          trailingStopPercent: this.config.trailingStopPercent,
          tpPriceUsd: entryPriceUsd * (1 + this.config.takeProfitPercent / 100),
          slPriceUsd: entryPriceUsd * (1 - this.config.stopLossPercent / 100),
          trailingStopPriceUsd: entryPriceUsd * (1 - this.config.trailingStopPercent / 100),
          autoSellStagnant: this.config.autoSellStagnant,
          stagnantTimeoutSeconds: this.config.stagnantTimeoutSeconds,
          stagnantThresholdPercent: this.config.stagnantThresholdPercent,
          status: 'OPEN',
          openedAt: Date.now(),
          lastUpdated: Date.now(),
          router: 'jupiter',
          executionMode: 'wallet',
          txHash: swapResult.txHash,
          pairAddress: report.pairAddress,
          dexId: report.dexId,
        };

        this.positionManager.addPosition(livePosition);
        return livePosition;
      }
    } finally {
      this.idempotency.releaseLock(lockKey);
    }
  }

  /**
   * Executes a sell order for an active position
   */
  public async executeSell(
    positionId: string,
    percent: number = 100,
    exitReason: 'tp' | 'sl' | 'trailing' | 'stagnant' | 'manual' = 'manual'
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    return this.positionManager.executeSell(positionId, percent, exitReason);
  }

  /**
   * Updates target parameters (TP, SL, Trailing, Stagnation)
   */
  public updatePositionTargets(
    positionId: string,
    targets: {
      tpPercent?: number;
      slPercent?: number;
      trailingStopPercent?: number;
      autoSellStagnant?: boolean;
      stagnantTimeoutSeconds?: number;
    }
  ): ActivePosition | null {
    return this.positionManager.updateTargets(positionId, targets);
  }

  /**
   * Computes comprehensive performance statistics for dashboard
   */
  public getStats(days: number = 7): PerformanceStatsResponse {
    const history = this.positionManager.getTradeHistory();
    const cutoff = Date.now() - days * 24 * 3600_000;
    const filteredTrades = history.filter((t) => t.closedAt >= cutoff);

    const totalTrades = filteredTrades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalPnlUsd = 0;
    let totalPnlSol = 0;
    let bestTradePnlPercent = 0;
    let worstTradePnlPercent = 0;
    let bestTradeSymbol = '';
    let worstTradeSymbol = '';
    let sumTradeDurationMs = 0;
    let totalSolGains = 0;
    let totalSolLosses = 0;

    const dailyMap = new Map<string, { pnlUsd: number; pnlSol: number; trades: number; wins: number; losses: number; volumeSol: number }>();

    for (const trade of filteredTrades) {
      const pnl = trade.realizedPnlUsd || 0;
      const pnlSol = trade.realizedPnlSol || 0;
      totalPnlUsd += pnl;
      totalPnlSol += pnlSol;

      if (pnl > 0) {
        winningTrades++;
        totalSolGains += pnlSol;
      } else if (pnl < 0) {
        losingTrades++;
        totalSolLosses += Math.abs(pnlSol);
      }

      if (trade.realizedPnlPercent > bestTradePnlPercent) {
        bestTradePnlPercent = trade.realizedPnlPercent;
        bestTradeSymbol = trade.tokenSymbol;
      }
      if (trade.realizedPnlPercent < worstTradePnlPercent) {
        worstTradePnlPercent = trade.realizedPnlPercent;
        worstTradeSymbol = trade.tokenSymbol;
      }

      if (trade.closedAt && trade.openedAt) {
        sumTradeDurationMs += Math.max(0, trade.closedAt - trade.openedAt);
      }

      const dayKey = new Date(trade.closedAt).toISOString().split('T')[0];
      const existing = dailyMap.get(dayKey) || { pnlUsd: 0, pnlSol: 0, trades: 0, wins: 0, losses: 0, volumeSol: 0 };
      existing.pnlUsd += pnl;
      existing.pnlSol += pnlSol;
      existing.trades += 1;
      if (pnl > 0) existing.wins += 1;
      else if (pnl < 0) existing.losses += 1;
      existing.volumeSol += trade.amountSol || 0;
      dailyMap.set(dayKey, existing);
    }

    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const avgTradeDurationSeconds = totalTrades > 0 ? Math.round(sumTradeDurationMs / (totalTrades * 1000)) : 0;
    let cumulativeSol = 0;

    const daysStats: DailyPerformanceStat[] = Array.from(dailyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, stat]) => {
        cumulativeSol += stat.pnlSol;
        return {
          date,
          displayDate: date.slice(5),
          timestamp: new Date(date).getTime(),
          tradesCount: stat.trades,
          wins: stat.wins,
          losses: stat.losses,
          breakeven: stat.trades - stat.wins - stat.losses,
          winRate: stat.trades > 0 ? (stat.wins / stat.trades) * 100 : 0,
          dailySolProfit: stat.pnlSol,
          cumulativeSolProfit: cumulativeSol,
          dailyUsdProfit: stat.pnlUsd,
          volumeSol: stat.volumeSol,
          callsEvaluated: stat.trades,
          callsPassed: stat.wins,
          snipingSuccessRate: stat.trades > 0 ? (stat.wins / stat.trades) * 100 : 0,
        };
      });

    const summary: PerformanceSummary = {
      timeframeDays: days,
      totalTrades,
      wins: winningTrades,
      losses: losingTrades,
      breakeven: totalTrades - winningTrades - losingTrades,
      winLossRatio: losingTrades > 0 ? winningTrades / losingTrades : winningTrades,
      winRatePercent: winRate,
      totalSolProfit: totalPnlSol,
      totalUsdProfit: totalPnlUsd,
      averageSolPerTrade: totalTrades > 0 ? totalPnlSol / totalTrades : 0,
      profitFactor: totalSolLosses > 0 ? totalSolGains / totalSolLosses : totalSolGains > 0 ? 99 : 1,
      totalSolGains,
      totalSolLosses,
      bestTradeSol: 0,
      worstTradeSol: 0,
      bestTradePercent: bestTradePnlPercent,
      worstTradePercent: worstTradePnlPercent,
      bestTradeSymbol,
      worstTradeSymbol,
      averageWinSol: winningTrades > 0 ? totalSolGains / winningTrades : 0,
      averageLossSol: losingTrades > 0 ? totalSolLosses / losingTrades : 0,
      averageDurationSec: avgTradeDurationSeconds,
      totalCallsEvaluated: totalTrades,
      totalCallsPassed: winningTrades,
      overallSnipingPassRate: winRate,
    };

    return {
      days: daysStats,
      summary,
    };
  }
}
