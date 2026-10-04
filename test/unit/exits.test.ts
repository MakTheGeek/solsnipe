import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { SimulationRouter } from '../../server/execution/simulationRouter';
import { ActivePosition, GMGNAnalysisReport } from '../../src/types';

describe('Unit Tests: Take Profit, Stop Loss & Trailing Exit Math', () => {
  const router = new SimulationRouter();

  const mockReport: GMGNAnalysisReport = {
    tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    tokenSymbol: 'BONK',
    tokenName: 'Bonk',
    priceUsd: 0.00002,
    marketCapUsd: 30000,
    volume24hUsd: 50000,
    volume1hUsd: 10000,
    top10HoldersPercent: 20,
    buyersCount: 150,
    sellersCount: 20,
    hasDescription: true,
    hasWebsite: true,
    hasSocial: true,
    socialActive: true,
    kolCount: 2,
    smartWalletCount: 5,
    isMintRenounced: true,
    isFreezeRenounced: true,
    conditions: [],
    allPassed: true,
    decision: 'SNIPED',
    evaluatedAt: Date.now(),
  };

  test('Creates simulated position with calculated entry price and targets', () => {
    const amountSol = 0.1;
    const solPriceUsd = 150;
    const pos = router.executeSimulatedBuy(mockReport, amountSol, 5, solPriceUsd);

    assert.ok(pos.id.startsWith('sim_pos_'));
    assert.strictEqual(pos.isSimulated, true);
    assert.strictEqual(pos.investedSol, 0.1);
    assert.ok(pos.amountTokens > 0);
    assert.ok(pos.entryPriceUsd > mockReport.priceUsd); // Slippage factored in
    assert.ok(pos.tpPriceUsd > pos.entryPriceUsd);
    assert.ok(pos.slPriceUsd < pos.entryPriceUsd);
  });

  test('Computes Take Profit PnL and trade item accurately', () => {
    const solPriceUsd = 150;
    const pos = router.executeSimulatedBuy(mockReport, 0.1, 0, solPriceUsd);
    // Simulate price pump +50%
    const tpPriceUsd = pos.entryPriceUsd * 1.5;
    const { position: updatedPos, trade } = router.executeSimulatedSell(pos, tpPriceUsd, 100, 'tp', solPriceUsd);

    assert.strictEqual(updatedPos.status, 'CLOSED');
    assert.strictEqual(trade.exitReason, 'tp');
    assert.ok(trade.realizedPnlPercent >= 49.9);
    assert.ok(trade.realizedPnlUsd > 0);
    assert.ok(trade.realizedPnlSol !== undefined && trade.realizedPnlSol > 0);
  });

  test('Computes Stop Loss exit accurately', () => {
    const solPriceUsd = 150;
    const pos = router.executeSimulatedBuy(mockReport, 0.1, 0, solPriceUsd);
    // Simulate drop -20%
    const slPriceUsd = pos.entryPriceUsd * 0.8;
    const { position: updatedPos, trade } = router.executeSimulatedSell(pos, slPriceUsd, 100, 'sl', solPriceUsd);

    assert.strictEqual(updatedPos.status, 'CLOSED');
    assert.strictEqual(trade.exitReason, 'sl');
    assert.ok(trade.realizedPnlPercent <= -19.9);
    assert.ok(trade.realizedPnlUsd < 0);
  });
});
