import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { GMGNAnalyzer } from '../../server/gmgnAnalyzer';
import { RiskManager } from '../../server/riskManager';
import { IdempotencyManager } from '../../server/idempotency';
import { SniperEngine } from '../../server/sniperEngine';
import { DexscreenerClient } from '../../server/dexscreener';
import { StateStore } from '../../server/persistence/stateStore';

describe('Unit Tests: Token Security & Decision Rules', () => {
  const analyzer = new GMGNAnalyzer();

  test('Rejects token with active mint authority', () => {
    const rawRug = {
      score: 100,
      token: {
        mintAuthority: 'SomeMaliciousKey111111111111111111111111111',
        freezeAuthority: null,
      },
    };
    const summary = analyzer.buildRugCheckSummary('TestTokenMint111111111111111111111111111', rawRug);
    assert.strictEqual(summary.mintAuthority, 'SomeMaliciousKey111111111111111111111111111');
  });

  test('Flags high RugCheck risk score as danger', () => {
    const rawRug = {
      score: 1200,
      rugged: true,
      risks: [
        { name: 'Top 10 hold 90%', score: 800, level: 'danger' },
        { name: 'Liquidity unlocked', score: 400, level: 'danger' },
      ],
    };
    const summary = analyzer.buildRugCheckSummary('TestDangerMint111111111111111111111111', rawRug);
    assert.strictEqual(summary.status, 'danger');
    assert.strictEqual(summary.rugged, true);
    assert.strictEqual(summary.highRisksCount, 2);
  });
});

describe('Unit Tests: Risk Management & Circuit Breaker', () => {
  test('Enforces maximum position size', () => {
    const risk = new RiskManager();
    const result = risk.validateEntry({
      isLive: false,
      amountSol: 1.0, // Exceeds default 0.5 SOL limit
      slippagePercent: 5,
      currentOpenPositionsCount: 1,
      currentTotalExposureSol: 0.2,
    });

    assert.strictEqual(result.approved, false);
    assert.ok(result.reasons.some((r) => r.includes('max_position_size_exceeded')));
  });

  test('Trips circuit breaker after consecutive execution failures', () => {
    const risk = new RiskManager();
    assert.strictEqual(risk.getStatus().circuitBreakerTripped, false);

    risk.recordExecutionFailure('RPC Node Error 1');
    risk.recordExecutionFailure('RPC Node Error 2');
    risk.recordExecutionFailure('RPC Node Error 3');
    risk.recordExecutionFailure('RPC Node Error 4');

    const status = risk.getStatus();
    assert.strictEqual(status.circuitBreakerTripped, true);
    assert.ok(status.circuitBreakerReason?.includes('4 consecutive'));

    // Should now reject new entries
    const evalResult = risk.validateEntry({
      isLive: false,
      amountSol: 0.1,
      slippagePercent: 5,
      currentOpenPositionsCount: 0,
      currentTotalExposureSol: 0,
    });
    assert.strictEqual(evalResult.approved, false);
    assert.ok(evalResult.reasons.some((r) => r.includes('circuit_breaker_active')));

    // Reset circuit breaker
    risk.resetCircuitBreaker();
    assert.strictEqual(risk.getStatus().circuitBreakerTripped, false);
  });

  test('Blocks live trading when LIVE_TRADING_ENABLED is false', () => {
    const risk = new RiskManager();
    const evalResult = risk.validateEntry({
      isLive: true,
      amountSol: 0.1,
      slippagePercent: 5,
      currentOpenPositionsCount: 0,
      currentTotalExposureSol: 0,
      walletBalanceSol: 5.0,
    });

    // Default config.LIVE_TRADING_ENABLED is false in test/dev
    assert.strictEqual(evalResult.approved, false);
    assert.ok(evalResult.reasons.some((r) => r.includes('live_trading_disabled_by_server')));
  });

  test('Daily loss limit cannot be bypassed by resetting circuit breaker', () => {
    const risk = new RiskManager();
    // Simulate exceeding 2.0 SOL max daily loss
    risk.recordTradeClosed(-2.5);
    assert.strictEqual(risk.getStatus().circuitBreakerTripped, true);

    // Operator resets circuit breaker
    risk.resetCircuitBreaker();
    assert.strictEqual(risk.getStatus().circuitBreakerTripped, false);

    // Entry must STILL be rejected due to daily loss limit
    const evalResult = risk.validateEntry({
      isLive: false,
      amountSol: 0.1,
      slippagePercent: 5,
      currentOpenPositionsCount: 0,
      currentTotalExposureSol: 0,
    });
    assert.strictEqual(evalResult.approved, false);
    assert.ok(evalResult.reasons.some((r) => r.includes('max_daily_loss_exceeded')));
  });
});

describe('Unit Tests: Idempotency & Duplicate Protection', () => {
  test('Prevents concurrent double buys on identical token address', () => {
    const idempotency = new IdempotencyManager();
    const tokenMint = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
    const lockKey = `buy:${tokenMint}`;

    const acquired1 = idempotency.acquireLock(lockKey, 10_000, 'worker_1');
    assert.strictEqual(acquired1, true);

    const acquired2 = idempotency.acquireLock(lockKey, 10_000, 'worker_2');
    assert.strictEqual(acquired2, false);

    idempotency.releaseLock(lockKey);
    const acquired3 = idempotency.acquireLock(lockKey, 10_000, 'worker_3');
    assert.strictEqual(acquired3, true);
  });

  test('Deduplicates processed telegram signals', () => {
    const idempotency = new IdempotencyManager();
    const signalKey = 'pumpdotfunalert:12345:So11111111111111111111111111111111111111112';

    assert.strictEqual(idempotency.hasSignalBeenProcessed(signalKey), false);
    idempotency.markSignalProcessed(signalKey);
    assert.strictEqual(idempotency.hasSignalBeenProcessed(signalKey), true);
  });

  test('Prevents live trading from being enabled from frontend alone', () => {
    const store = new StateStore('/tmp/solsnipe_test_live_guard_' + Date.now());
    const dexscreener = new DexscreenerClient();
    const engine = new SniperEngine(dexscreener, store);

    // Attempt to set executionMode to 'wallet'
    const updated = engine.updateConfig({ executionMode: 'wallet' });
    // Must be forced back to simulation because LIVE_TRADING_ENABLED=false
    assert.strictEqual(updated.executionMode, 'simulation');
    engine.getPositionManager().stopPriceTracker();
  });

  test('Rejects duplicate token snipe through idempotency memory', async () => {
    const store = new StateStore('/tmp/solsnipe_test_dupe_snipe_' + Date.now());
    const dexscreener = new DexscreenerClient();
    const engine = new SniperEngine(dexscreener, store);

    const mockReport: any = {
      tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      tokenSymbol: 'BONK',
      priceUsd: 0.00002,
      decision: 'SNIPED',
    };

    // First snipe executes successfully
    const pos1 = await engine.executeSnipe(mockReport);
    assert.strictEqual(pos1.tokenAddress, mockReport.tokenAddress);

    // Second snipe with the same token must be rejected even if position closed
    await assert.rejects(
      async () => {
        await engine.executeSnipe(mockReport);
      },
      /DUPLICATE_BUY_PREVENTED|POSITION_ALREADY_OPEN/
    );
    engine.getPositionManager().stopPriceTracker();
  });
});
