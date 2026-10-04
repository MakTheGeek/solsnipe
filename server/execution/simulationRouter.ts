import { ActivePosition, GMGNAnalysisReport, TradeHistoryItem } from '../../src/types';
import { logger } from '../logger';

export class SimulationRouter {
  public executeSimulatedBuy(
    report: GMGNAnalysisReport,
    amountSol: number,
    slippagePercent: number,
    solPriceUsd: number
  ): ActivePosition {
    const entryPriceUsd = report.priceUsd > 0 ? report.priceUsd : 0.00001;
    // Apply realistic slippage factor to entry price (up to half of configured slippage)
    const effectiveSlippage = (slippagePercent / 100) * 0.5;
    const executionPriceUsd = entryPriceUsd * (1 + effectiveSlippage);

    const investmentUsd = amountSol * solPriceUsd;
    const tokenAmount = executionPriceUsd > 0 ? investmentUsd / executionPriceUsd : 0;

    const txHash = `sim_buy_${Date.now().toString(16)}_${Math.random().toString(36).substring(2, 8)}`;

    logger.info(
      'SimulationRouter',
      `[SIMULATION BUY] ${report.tokenSymbol || report.tokenAddress.slice(0, 8)}: ${amountSol} SOL ($${investmentUsd.toFixed(2)}) @ $${executionPriceUsd.toFixed(8)} | Tx: ${txHash}`
    );

    const position: ActivePosition = {
      id: `sim_pos_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tokenAddress: report.tokenAddress,
      tokenSymbol: report.tokenSymbol || 'UNKNOWN',
      tokenName: report.tokenName || 'Unknown Token',
      entryPriceUsd: executionPriceUsd,
      entryPriceSol: solPriceUsd > 0 ? executionPriceUsd / solPriceUsd : 0,
      currentPriceUsd: executionPriceUsd,
      currentPriceSol: solPriceUsd > 0 ? executionPriceUsd / solPriceUsd : 0,
      peakPriceUsd: executionPriceUsd,
      lowestPriceUsd: executionPriceUsd,
      amountTokens: tokenAmount,
      amountSol,
      investedSol: amountSol,
      investedUsd: investmentUsd,
      currentValueUsd: investmentUsd,
      unrealizedPnlUsd: 0,
      unrealizedPnlPercent: 0,
      pnlUsd: 0,
      pnlPercent: 0,
      tpPercent: 50,
      slPercent: 15,
      trailingStopPercent: 10,
      tpPriceUsd: executionPriceUsd * 1.5,
      slPriceUsd: executionPriceUsd * 0.85,
      trailingStopPriceUsd: executionPriceUsd * 0.9,
      autoSellStagnant: true,
      stagnantTimeoutSeconds: 180,
      stagnantThresholdPercent: 1.0,
      stagnantDetectedAt: Date.now(),
      status: 'OPEN',
      openedAt: Date.now(),
      lastUpdated: Date.now(),
      router: 'jupiter',
      executionMode: 'simulation',
      pairAddress: report.pairAddress,
      dexId: report.dexId,
      txHash,
      isSimulated: true,
    };

    return position;
  }

  public executeSimulatedSell(
    position: ActivePosition,
    currentPriceUsd: number,
    percent: number,
    exitReason: 'tp' | 'sl' | 'trailing' | 'stagnant' | 'manual' | string,
    solPriceUsd: number
  ): { position: ActivePosition; trade: TradeHistoryItem } {
    const sellPriceUsd = currentPriceUsd > 0 ? currentPriceUsd : position.currentPriceUsd;
    const tokensToSell = (position.amountTokens * percent) / 100;
    const entryUsd = (position.amountSol * solPriceUsd * percent) / 100;
    const exitUsd = tokensToSell * sellPriceUsd;

    const pnlUsd = exitUsd - entryUsd;
    const pnlPercent = entryUsd > 0 ? (pnlUsd / entryUsd) * 100 : 0;
    const pnlSol = solPriceUsd > 0 ? pnlUsd / solPriceUsd : 0;

    const txHash = `sim_sell_${Date.now().toString(16)}_${Math.random().toString(36).substring(2, 8)}`;

    logger.info(
      'SimulationRouter',
      `[SIMULATION SELL] ${position.tokenSymbol} (${exitReason.toUpperCase()}): Sold ${percent}% @ $${sellPriceUsd.toFixed(8)} | PnL: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ($${pnlUsd.toFixed(2)}) | Tx: ${txHash}`
    );

    const trade: TradeHistoryItem = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tokenAddress: position.tokenAddress,
      tokenSymbol: position.tokenSymbol,
      tokenName: position.tokenName,
      buyPriceUsd: position.entryPriceUsd,
      sellPriceUsd,
      entryPriceUsd: position.entryPriceUsd,
      exitPriceUsd: sellPriceUsd,
      amountSol: (position.amountSol * percent) / 100,
      realizedPnlUsd: pnlUsd,
      realizedPnlPercent: pnlPercent,
      realizedPnlSol: pnlSol,
      pnlUsd,
      pnlPercent,
      pnlSol,
      openedAt: position.openedAt,
      closedAt: Date.now(),
      exitReason,
      router: 'jupiter',
      executionMode: 'simulation',
      txHash,
      isSimulated: true,
    };

    const remainingTokens = position.amountTokens - tokensToSell;
    const updatedPosition: ActivePosition = {
      ...position,
      amountTokens: remainingTokens,
      status: percent >= 100 || remainingTokens <= 0 ? 'CLOSED' : 'OPEN',
      lastUpdated: Date.now(),
      currentPriceUsd: sellPriceUsd,
    };

    return { position: updatedPosition, trade };
  }
}
