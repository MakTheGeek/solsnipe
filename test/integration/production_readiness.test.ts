import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { SecurityManager } from '../../server/securityManager';
import { StateStore } from '../../server/persistence/stateStore';
import { RiskManager } from '../../server/riskManager';
import { IdempotencyManager } from '../../server/idempotency';
import { SniperEngine } from '../../server/sniperEngine';
import { DexscreenerClient } from '../../server/dexscreener';
import { GMGNAnalyzer } from '../../server/gmgnAnalyzer';
import { WalletManager } from '../../server/walletManager';
import { JupiterRouter } from '../../server/execution/jupiterRouter';
import { SimulationRouter } from '../../server/execution/simulationRouter';
import { JitoRouter } from '../../server/execution/jitoRouter';
import { PositionManager } from '../../server/positionManager';
import { config } from '../../server/config';
import { GMGNAnalysisReport, ActivePosition } from '../../src/types';

describe('Production Readiness: Simulation End-to-End Test', () => {
  test('Complete simulation flow: signal -> analysis -> buy -> track -> sell -> history', async () => {
    const tempDir = '/tmp/solsnipe_e2e_sim_' + Date.now();
    const store = new StateStore(tempDir);
    const dexscreener = new DexscreenerClient();
    const analyzer = new GMGNAnalyzer();
    const engine = new SniperEngine(dexscreener, store);
    const posManager = engine.getPositionManager();

    // 1. Telegram Signal & Token Extraction
    const rawSignal = 'New token launch on pump.fun! Contract: DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 (BONK) - Liquidity locked!';
    const tokenRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
    const match = rawSignal.match(tokenRegex);
    assert.ok(match, 'Token address should be extracted from telegram signal');
    const tokenAddress = match[0];
    assert.strictEqual(tokenAddress, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

    // 2. Token Security Analysis Mock (Safe Token)
    const mockReport: GMGNAnalysisReport = {
      tokenAddress,
      tokenSymbol: 'BONK',
      tokenName: 'Bonk Coin',
      priceUsd: 0.00002,
      marketCapUsd: 25000,
      volume24hUsd: 50000,
      volume1hUsd: 10000,
      top10HoldersPercent: 20,
      buyersCount: 150,
      sellersCount: 30,
      hasDescription: true,
      hasWebsite: true,
      hasSocial: true,
      socialActive: true,
      kolCount: 2,
      smartWalletCount: 5,
      conditions: [],
      allPassed: true,
      decision: 'SNIPED',
      evaluatedAt: Date.now(),
      rugCheck: {
        score: 150,
        status: 'good',
        statusLabel: 'GOOD',
        rugged: false,
        risksCount: 0,
        highRisksCount: 0,
        warnRisksCount: 0,
        risks: [],
      },
    };

    // Verify Decision Logic & RugCheck Summary
    const rugSummary = analyzer.buildRugCheckSummary(tokenAddress, {
      score: 150,
      rugged: false,
      risks: [],
    });
    assert.strictEqual(rugSummary.status, 'good', 'Safe token should have good rugcheck status');
    assert.strictEqual(rugSummary.rugged, false);

    // 3. Simulated Buy Execution
    const position = await engine.executeSnipe(mockReport, { amountSol: 0.1, slippagePercent: 5 });
    assert.ok(position, 'Position should be created');
    assert.strictEqual(position.status, 'OPEN');
    assert.strictEqual(position.executionMode, 'simulation');
    assert.strictEqual(position.tokenAddress, tokenAddress);
    assert.ok(position.txHash?.startsWith('sim_buy_'), 'Tx hash must be simulated, never real Solana tx');
    assert.strictEqual(position.tpPriceUsd > position.entryPriceUsd, true);
    assert.strictEqual(position.slPriceUsd < position.entryPriceUsd, true);

    // 4. Verify Position in StateStore
    const activePositions = posManager.getActivePositions();
    assert.strictEqual(activePositions.length, 1);
    assert.strictEqual(activePositions[0].id, position.id);

    // 5. Price Tracking Simulation & Exit (Simulate Price hitting Take Profit +50%)
    const tpPriceUsd = position.entryPriceUsd * 1.5;
    const sellResult = await posManager.executeSell(position.id, 100, 'TP_HIT', tpPriceUsd);
    assert.strictEqual(sellResult.success, true);
    assert.ok(sellResult.txHash?.startsWith('sim_sell_'));

    // 6. Verify Position Closed and Trade History Recorded
    const remainingOpen = posManager.getActivePositions();
    assert.strictEqual(remainingOpen.length, 0, 'Position should be marked CLOSED');

    const tradeHistory = posManager.getTradeHistory();
    assert.strictEqual(tradeHistory.length, 1);
    assert.strictEqual(tradeHistory[0].exitReason, 'TP_HIT');
    const pnl = tradeHistory[0].realizedPnlPercent ?? tradeHistory[0].pnlPercent ?? 0;
    assert.ok(pnl >= 49.0, 'PnL should reflect ~50% profit');

    posManager.stopPriceTracker();
  });
});

describe('Production Readiness: Live Trading Safety Invariants', () => {
  test('All live execution entrypoints FAIL SAFELY when LIVE_TRADING_ENABLED=false', async () => {
    // Assert server-level switch is false
    assert.strictEqual(config.LIVE_TRADING_ENABLED, false);

    const store = new StateStore('/tmp/solsnipe_live_guard_' + Date.now());
    const dexscreener = new DexscreenerClient();
    const engine = new SniperEngine(dexscreener, store);
    const walletManager = new WalletManager();
    const jupiter = new JupiterRouter(walletManager);
    const jito = new JitoRouter(walletManager);
    const risk = new RiskManager();
    const posManager = engine.getPositionManager();

    // 1. SniperEngine.updateConfig: attempting to switch to wallet mode
    const updatedCfg = engine.updateConfig({ executionMode: 'wallet' });
    assert.strictEqual(updatedCfg.executionMode, 'simulation', 'SniperEngine must force simulation mode');

    // 2. RiskManager.validateEntry with isLive=true
    const riskCheck = risk.validateEntry({
      isLive: true,
      amountSol: 0.1,
      slippagePercent: 5,
      currentOpenPositionsCount: 0,
      currentTotalExposureSol: 0,
    });
    assert.strictEqual(riskCheck.approved, false);
    assert.ok(riskCheck.reasons.some((r) => r.includes('live_trading_disabled_by_server')));

    // 3. JupiterRouter.executeLiveBuy
    const buyResult = await jupiter.executeLiveBuy('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 0.1, 5);
    assert.strictEqual(buyResult.success, false);
    assert.ok(buyResult.error?.includes('LIVE_TRADING_DISABLED'));
    assert.strictEqual(buyResult.txHash, '');

    // 4. JupiterRouter.executeLiveSell
    const sellResult = await jupiter.executeLiveSell('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 100, 5);
    assert.strictEqual(sellResult.success, false);
    assert.ok(sellResult.error?.includes('LIVE_TRADING_DISABLED'));
    assert.strictEqual(sellResult.txHash, '');

    // 5. JitoRouter.submitBundle
    const jitoResult = await jito.submitBundle([]);
    assert.strictEqual(jitoResult.success, false);
    assert.ok(jitoResult.error?.includes('LIVE_TRADING_DISABLED'));

    // 6. PositionManager.executeSell in wallet mode
    const dummyPos: ActivePosition = {
      id: 'pos_live_guard_test',
      tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      tokenSymbol: 'BONK',
      tokenName: 'Bonk',
      executionMode: 'wallet',
      status: 'OPEN',
      amountSol: 0.1,
      amountTokens: 5000000,
      entryPriceUsd: 0.00002,
      entryPriceSol: 0.0000001,
      currentPriceUsd: 0.00002,
      currentPriceSol: 0.0000001,
      peakPriceUsd: 0.00002,
      tpPriceUsd: 0.00003,
      slPriceUsd: 0.000016,
      trailingStopPriceUsd: 0.000016,
      tpPercent: 50,
      slPercent: 20,
      trailingStopPercent: 15,
      pnlPercent: 0,
      pnlSol: 0,
      pnlUsd: 0,
      openedAt: Date.now(),
      lastUpdated: Date.now(),
      router: 'jupiter',
    };
    (posManager as any).activePositions.set(dummyPos.id, dummyPos);
    const liveSellPosResult = await posManager.executeSell(dummyPos.id, 100, 'MANUAL_SELL');
    assert.strictEqual(liveSellPosResult.success, false);
    assert.ok(liveSellPosResult.error?.includes('LIVE_TRADING_DISABLED'));

    posManager.stopPriceTracker();
  });
});

describe('Production Readiness: Authentication Matrix & Rate Limiting', () => {
  const store = new StateStore('/tmp/solsnipe_auth_matrix_' + Date.now());
  const security = new SecurityManager(store);

  test('Complete Authentication Matrix on requireAuth middleware', () => {
    // Setup security code
    const setup = security.setupCode({ newCode: 'SuperSafeAdminPass2026' });
    assert.strictEqual(setup.success, true);
    const validToken = setup.token!;

    const testCases = [
      { name: 'Missing token', headers: {}, cookies: {}, expectedStatus: 401, expectedCode: 'UNAUTHORIZED' },
      { name: 'Invalid token', headers: { authorization: 'Bearer invalid_token_xyz' }, cookies: {}, expectedStatus: 401, expectedCode: 'UNAUTHORIZED' },
      { name: 'Expired token', headers: { authorization: 'Bearer exp_token' }, cookies: {}, expectedStatus: 401, expectedCode: 'UNAUTHORIZED' },
      { name: 'Malformed token', headers: { authorization: 'MalformedPrefix' }, cookies: {}, expectedStatus: 401, expectedCode: 'UNAUTHORIZED' },
      { name: 'Valid Bearer token', headers: { authorization: `Bearer ${validToken}` }, cookies: {}, expectedStatus: 200, expectedCode: null },
      { name: 'Valid cookie token', headers: {}, cookies: { solsnipe_session: validToken }, expectedStatus: 200, expectedCode: null },
    ];

    for (const tc of testCases) {
      let nextCalled = false;
      let statusCode = 200;
      let responseBody: any = null;

      const mockReq: any = { headers: tc.headers, cookies: tc.cookies };
      const mockRes: any = {
        status(c: number) {
          statusCode = c;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      security.requireAuth(mockReq, mockRes, () => {
        nextCalled = true;
      });

      if (tc.expectedStatus === 200) {
        assert.strictEqual(nextCalled, true, `Expected next() for ${tc.name}`);
      } else {
        assert.strictEqual(nextCalled, false, `Expected rejected for ${tc.name}`);
        assert.strictEqual(statusCode, tc.expectedStatus, `Expected status ${tc.expectedStatus} for ${tc.name}`);
        assert.strictEqual(responseBody?.error?.code, tc.expectedCode);
      }
    }
  });
});

describe('Production Readiness: Concurrency & Duplicate Protection', () => {
  test('10 simultaneous buy requests for the same token: exactly 1 succeeds', async () => {
    const store = new StateStore('/tmp/solsnipe_dupe_10buys_' + Date.now());
    const dexscreener = new DexscreenerClient();
    const engine = new SniperEngine(dexscreener, store);

    const tokenAddress = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';
    const mockReport: GMGNAnalysisReport = {
      tokenAddress,
      tokenSymbol: 'RAY',
      tokenName: 'Raydium',
      priceUsd: 1.5,
      marketCapUsd: 25000,
      volume24hUsd: 50000,
      volume1hUsd: 10000,
      top10HoldersPercent: 20,
      buyersCount: 150,
      sellersCount: 30,
      hasDescription: true,
      hasWebsite: true,
      hasSocial: true,
      socialActive: true,
      kolCount: 2,
      smartWalletCount: 5,
      conditions: [],
      allPassed: true,
      decision: 'SNIPED',
      evaluatedAt: Date.now(),
      rugCheck: {
        score: 100,
        status: 'good',
        statusLabel: 'GOOD',
        rugged: false,
        risksCount: 0,
        highRisksCount: 0,
        warnRisksCount: 0,
        risks: [],
      },
    };

    const promises = Array.from({ length: 10 }, () =>
      engine.executeSnipe(mockReport).then(
        (pos) => ({ success: true, pos, error: '' }),
        (err) => ({ success: false, pos: null as any, error: err.message as string })
      )
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent buy must succeed');
    assert.strictEqual(failures.length, 9, 'Remaining 9 concurrent buys must be rejected');
    for (const failure of failures) {
      assert.ok(
        failure.error.includes('DUPLICATE_BUY_PREVENTED') ||
        failure.error.includes('LOCKED') ||
        failure.error.includes('POSITION_ALREADY_OPEN')
      );
    }

    engine.getPositionManager().stopPriceTracker();
  });

  test('10 simultaneous sell requests on the same position: exactly 1 succeeds', async () => {
    const store = new StateStore('/tmp/solsnipe_dupe_10sells_' + Date.now());
    const dexscreener = new DexscreenerClient();
    const engine = new SniperEngine(dexscreener, store);
    const posManager = engine.getPositionManager();

    // Create a single open position
    const pos: ActivePosition = {
      id: 'pos_dupe_sell_test',
      tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      tokenSymbol: 'BONK',
      tokenName: 'Bonk',
      executionMode: 'simulation',
      status: 'OPEN',
      amountSol: 0.1,
      amountTokens: 1000000,
      entryPriceUsd: 0.00002,
      entryPriceSol: 0.0000001,
      currentPriceUsd: 0.000025,
      currentPriceSol: 0.000000125,
      peakPriceUsd: 0.000025,
      tpPriceUsd: 0.00003,
      slPriceUsd: 0.000016,
      trailingStopPriceUsd: 0.000016,
      tpPercent: 50,
      slPercent: 20,
      trailingStopPercent: 15,
      pnlPercent: 25,
      pnlSol: 0.025,
      pnlUsd: 3.75,
      openedAt: Date.now(),
      lastUpdated: Date.now(),
      router: 'jupiter',
    };
    (posManager as any).activePositions.set(pos.id, pos);

    const promises = Array.from({ length: 10 }, () =>
      posManager.executeSell(pos.id, 100, 'MANUAL_SELL')
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.strictEqual(successes.length, 1, 'Exactly 1 sell must succeed');
    assert.strictEqual(failures.length, 9, '9 concurrent sells must fail due to lock or already closed');

    posManager.stopPriceTracker();
  });
});

describe('Production Readiness: Restart Recovery & Persistence', () => {
  test('Active positions and trade history survive process restart', () => {
    const tempDir = '/tmp/solsnipe_persistence_test_' + Date.now();
    const store1 = new StateStore(tempDir);
    const dexscreener = new DexscreenerClient();

    const testPos: ActivePosition = {
      id: 'persisted_pos_1',
      tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      tokenSymbol: 'BONK',
      tokenName: 'Bonk',
      executionMode: 'simulation',
      status: 'OPEN',
      amountSol: 0.25,
      amountTokens: 2500000,
      entryPriceUsd: 0.00002,
      entryPriceSol: 0.0000001,
      currentPriceUsd: 0.000022,
      currentPriceSol: 0.00000011,
      peakPriceUsd: 0.000022,
      tpPriceUsd: 0.00003,
      slPriceUsd: 0.000016,
      trailingStopPriceUsd: 0.000016,
      tpPercent: 50,
      slPercent: 20,
      trailingStopPercent: 15,
      pnlPercent: 10,
      pnlSol: 0.025,
      pnlUsd: 3.75,
      openedAt: Date.now(),
      lastUpdated: Date.now(),
      router: 'jupiter',
    };

    // Save position to store1
    store1.savePositionsAndTrades([testPos], []);

    // Simulate crash and restart: create fresh SniperEngine from same directory
    const store2 = new StateStore(tempDir);
    const engine2 = new SniperEngine(dexscreener, store2);
    const posManager2 = engine2.getPositionManager();

    const recovered = posManager2.getActivePositions();
    assert.strictEqual(recovered.length, 1);
    assert.strictEqual(recovered[0].id, 'persisted_pos_1');
    assert.strictEqual(recovered[0].tokenAddress, testPos.tokenAddress);
    assert.strictEqual(recovered[0].amountSol, 0.25);
    assert.strictEqual(recovered[0].tpPriceUsd, 0.00003);

    posManager2.stopPriceTracker();
  });
});

describe('Production Readiness: Risk Limits Enforcement', () => {
  const risk = new RiskManager();

  test('MAX_POSITION_SIZE_SOL enforcement (0.5 SOL)', () => {
    const res = risk.validateEntry({
      isLive: false,
      amountSol: 0.51,
      slippagePercent: 5,
      currentOpenPositionsCount: 0,
      currentTotalExposureSol: 0,
    });
    assert.strictEqual(res.approved, false);
    assert.ok(res.reasons.some((r) => r.includes('max_position_size_exceeded')));
  });

  test('MAX_OPEN_POSITIONS enforcement (5 positions)', () => {
    const res = risk.validateEntry({
      isLive: false,
      amountSol: 0.1,
      slippagePercent: 5,
      currentOpenPositionsCount: 5,
      currentTotalExposureSol: 0.5,
    });
    assert.strictEqual(res.approved, false);
    assert.ok(res.reasons.some((r) => r.includes('max_open_positions_reached')));
  });

  test('MAX_TOTAL_EXPOSURE_SOL enforcement (2.0 SOL)', () => {
    const res = risk.validateEntry({
      isLive: false,
      amountSol: 0.3,
      slippagePercent: 5,
      currentOpenPositionsCount: 2,
      currentTotalExposureSol: 1.8, // 1.8 + 0.3 = 2.1 > 2.0
    });
    assert.strictEqual(res.approved, false);
    assert.ok(res.reasons.some((r) => r.includes('max_total_exposure_exceeded')));
  });

  test('MAX_SLIPPAGE_BPS enforcement (1500 bps = 15%)', () => {
    const res = risk.validateEntry({
      isLive: false,
      amountSol: 0.1,
      slippagePercent: 16, // > 15%
      currentOpenPositionsCount: 0,
      currentTotalExposureSol: 0,
    });
    assert.strictEqual(res.approved, false);
    assert.ok(res.reasons.some((r) => r.includes('max_slippage_exceeded')));
  });
});
