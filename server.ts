import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { config } from './server/config';
import { DexscreenerClient } from './server/dexscreener';
import { GMGNAnalyzer } from './server/gmgnAnalyzer';
import { logger } from './server/logger';
import { createRateLimiter } from './server/middleware/rateLimiter';
import {
  importWalletSchema,
  manualSnipeSchema,
  sellPositionSchema,
  updateConfigSchema,
  updateTargetsSchema,
  validateBody,
} from './server/middleware/validation';
import { StateStore } from './server/persistence/stateStore';
import { SecurityManager } from './server/securityManager';
import { SniperEngine } from './server/sniperEngine';
import { TelegramListener } from './server/telegramListener';

// Handle uncaught errors gracefully
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason || '');
  if (msg.includes('Not connected')) return;
  logger.warn('Process', 'Unhandled rejection:', reason);
});

process.on('uncaughtException', (err: any) => {
  const msg = err?.message || String(err || '');
  if (msg.includes('Not connected')) return;
  logger.error('Process', 'Uncaught exception:', err);
});

async function startServer() {
  const app = express();
  const PORT = config.PORT;

  // 1. Trust proxy in production containers (Cloud Run, Docker, Nginx)
  app.set('trust proxy', 1);

  // 2. Security Headers Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https: blob:; connect-src 'self' https: wss:;"
    );
    next();
  });

  // 3. CORS Configuration (Strictly restricted, Never '*')
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const allowed = [config.APP_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'];
    const host = req.headers.host;
    const hostOriginHttp = host ? `http://${host}` : '';
    const hostOriginHttps = host ? `https://${host}` : '';
    const isAllowed =
      origin &&
      (allowed.includes(origin) || origin === hostOriginHttp || origin === hostOriginHttps);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // 4. Request Parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // 5. Core Services Initialization
  const stateStore = new StateStore();
  const securityManager = new SecurityManager(stateStore);
  const dexscreener = new DexscreenerClient();
  const gmgnAnalyzer = new GMGNAnalyzer();
  const sniperEngine = new SniperEngine(dexscreener, stateStore);

  // Link sniper configuration to GMGNAnalyzer for live safety thresholds
  gmgnAnalyzer.setConfigGetter(() => sniperEngine.getConfig());

  // 6. Realtime Server-Sent Events (SSE) Manager
  const sseClients = new Set<Response>();

  const broadcast = (event: { type: string; data: any }) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  sniperEngine.setCallbacks(
    (positions) => broadcast({ type: 'POSITIONS_UPDATED', data: positions }),
    (trade) => broadcast({ type: 'TRADE_EXECUTED', data: trade })
  );

  // 7. Telegram Listener Service
  const telegramListener = new TelegramListener({
    stateStore,
    onCallUpdated: (call) => broadcast({ type: 'CALL_UPDATED', data: call }),
    onCall: async (call) => {
      broadcast({ type: 'CALL_DETECTED', data: call });

      // Run on-chain multi-source security audit
      try {
        const report = await gmgnAnalyzer.analyzeToken(call.tokenAddress, {
          rawText: call.rawText,
          claimedMarketCap: call.claimedMarketCap,
          claimedAge: call.claimedAge,
          symbol: call.tokenSymbol,
          tokenName: call.tokenName,
          channel: call.channel,
        });

        call.analysis = report;
        call.status = report.decision;
        if (report.rugCheck) call.rugCheck = report.rugCheck;
        if (!call.tokenSymbol && report.tokenSymbol) call.tokenSymbol = report.tokenSymbol;
        if (report.rejectionReason && report.decision === 'REJECTED') call.error = report.rejectionReason;

        telegramListener.updateCall(call);
        broadcast({ type: 'CALL_ANALYZED', data: call });

        // Guard: Prevent auto-sniping historical or stale calls (> 2 minutes old)
        const callAgeSeconds = Math.max(0, Math.round((Date.now() - call.timestamp) / 1000));
        if (call.isHistorical || !call.canAutoSnipe || callAgeSeconds > 120) {
          logger.info(
            'Server',
            `Auto-snipe bypassed: Call is historical/stale (${callAgeSeconds}s old). Displayed in feed only.`
          );
          return;
        }

        // Auto-snipe trigger for passed tokens
        if (report.decision === 'SNIPED' && sniperEngine.getConfig().autoSnipe) {
          logger.info('Server', `⚡ Auto-sniping fresh signal: ${report.tokenSymbol} (${call.tokenAddress})`);
          try {
            const pos = await sniperEngine.executeSnipe(report);
            broadcast({ type: 'SNIPE_EXECUTED', data: pos });
          } catch (snipeErr: any) {
            logger.warn('Server', `Auto-snipe halted: ${snipeErr.message}`);
            call.status = 'REJECTED';
            call.error = snipeErr.message;
            if (call.analysis) call.analysis.decision = 'REJECTED';
            telegramListener.updateCall(call);
            broadcast({ type: 'CALL_UPDATED', data: call });
          }
        }
      } catch (err: any) {
        logger.error('Server', `Error auditing signal ${call.tokenAddress}:`, err);
        call.status = 'REJECTED';
        call.error = 'Audit pipeline failure';
        telegramListener.updateCall(call);
        broadcast({ type: 'CALL_UPDATED', data: call });
      }
    },
  });

  // Start background listener
  telegramListener.start().catch((err) => {
    logger.warn('Server', 'TelegramListener initial start returned:', err);
  });

  // 8. Rate Limiters
  const authRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10, message: 'Too many authentication attempts' });
  const snipeRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 15, message: 'Too many snipe requests' });
  const sellRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20, message: 'Too many sell requests' });
  const telegramRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10, message: 'Too many Telegram verification requests' });
  const refreshRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 20, message: 'Too many refresh requests' });
  const generalRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 120 });

  app.use('/api/', generalRateLimiter);

  // ============================================================================
  // API ROUTES
  // ============================================================================

  // --- SSE REALTIME STREAM (AUTHENTICATED & CONNECTION CAPPED) ---
  app.get('/api/stream', (req: Request, res: Response) => {
    // Check session authentication if security code is configured
    const token =
      (req.cookies && req.cookies['solsnipe_session']) ||
      (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
        ? req.headers.authorization.substring(7).trim()
        : '') ||
      (typeof req.query.token === 'string' ? req.query.token.trim() : '');

    if (securityManager.getStatus().hasCodeSet && !securityManager.isTokenValid(token)) {
      res.status(401).json({ success: false, error: 'UNAUTHORIZED_STREAM' });
      return;
    }

    // Protection against SSE connection exhaustion DoS
    if (sseClients.size >= 50) {
      res.status(429).json({ success: false, error: 'TOO_MANY_STREAM_CLIENTS' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Initial state push
    const initialConfig = sniperEngine.getConfig();
    const payload = JSON.stringify({
      type: 'INIT',
      data: {
        status: {
          telegram: telegramListener.getStatus(),
          positionsCount: sniperEngine.getActivePositions().length,
          config: initialConfig,
          security: securityManager.getStatus(),
          risk: sniperEngine.getRiskManager().getStatus(),
        },
        positions: sniperEngine.getActivePositions(),
        history: sniperEngine.getTradeHistory().slice(0, 50),
        calls: telegramListener.getCalls().slice(0, 50),
      },
    });
    res.write(`data: ${payload}\n\n`);

    sseClients.add(res);

    // Heartbeat every 15s to keep connection alive through load balancers
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // --- HEALTH & OBSERVABILITY ---
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'solsnipe-bot',
      mode: 'simulation',
      liveTradingEnabled: false,
      timestamp: Date.now(),
      uptimeSeconds: Math.round(process.uptime()),
      components: {
        api: 'healthy',
        engine: 'healthy',
        persistence: 'healthy',
      },
    });
  });

  app.get('/ready', (req: Request, res: Response) => {
    const wallet = sniperEngine.getWalletManager().getStatus();
    const tg = telegramListener.getStatus();
    const isReady = wallet.rpcHealthy !== false;
    res.status(isReady ? 200 : 503).json({
      ready: isReady,
      mode: 'simulation',
      liveTradingEnabled: false,
      rpcHealthy: wallet.rpcHealthy,
      telegramConnected: tg.connected,
      hasWallet: wallet.isConfigured,
      timestamp: Date.now(),
    });
  });

  app.get('/api/status', (req: Request, res: Response) => {
    const config = sniperEngine.getConfig();
    const risk = sniperEngine.getRiskManager().getStatus(
      sniperEngine.getActivePositions().length,
      sniperEngine.getActivePositions().reduce((acc, p) => acc + p.amountSol, 0)
    );
    res.json({
      telegram: telegramListener.getStatus(),
      positionsCount: sniperEngine.getActivePositions().length,
      config,
      security: securityManager.getStatus(),
      risk,
    });
  });

  app.get('/api/metrics', (req: Request, res: Response) => {
    const risk = sniperEngine.getRiskManager().getStatus();
    const tg = telegramListener.getStatus();
    res.json({
      success: true,
      metrics: {
        signalsReceived: tg.totalAlertsReceived,
        duplicatesFiltered: tg.totalDuplicatesFiltered,
        openPositions: sniperEngine.getActivePositions().length,
        totalTrades: sniperEngine.getTradeHistory().length,
        dailyLossSol: risk.dailyLossSol,
        circuitBreakerActive: risk.circuitBreakerTripped,
        liveTradingEnabled: risk.liveTradingEnabled,
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  });

  // --- SENSITIVE READ DATA (PROTECTED) ---
  app.get('/api/calls', securityManager.requireAuth, (req: Request, res: Response) => {
    res.json(telegramListener.getCalls());
  });

  app.get('/api/telegram/calls', securityManager.requireAuth, (req: Request, res: Response) => {
    res.json(telegramListener.getCalls());
  });

  app.get('/api/telegram/status', (req: Request, res: Response) => {
    res.json(telegramListener.getStatus());
  });

  app.get('/api/positions', securityManager.requireAuth, (req: Request, res: Response) => {
    res.json(sniperEngine.getActivePositions());
  });

  app.get('/api/history', securityManager.requireAuth, (req: Request, res: Response) => {
    res.json(sniperEngine.getTradeHistory());
  });

  app.get('/api/stats', securityManager.requireAuth, (req: Request, res: Response) => {
    const days = parseInt(String(req.query.days || '7'), 10) || 7;
    res.json(sniperEngine.getStats(days));
  });

  app.get('/api/config', securityManager.requireAuth, (req: Request, res: Response) => {
    res.json(sniperEngine.getConfig());
  });

  app.get('/api/security/status', (req: Request, res: Response) => {
    res.json(securityManager.getStatus());
  });

  // --- AUTHENTICATION & SECURITY ENDPOINTS ---
  app.post('/api/security/verify', authRateLimiter, (req: Request, res: Response) => {
    const { code } = req.body;
    const result = securityManager.verifyCode(code);
    if (result.success && result.token) {
      res.cookie('solsnipe_session', result.token, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: config.AUTO_LOCK_MINUTES > 0 ? config.AUTO_LOCK_MINUTES * 60 * 1000 : undefined,
      });
    }
    res.json(result);
  });

  app.post('/api/security/logout', (req: Request, res: Response) => {
    const token = req.cookies?.['solsnipe_session'];
    if (token) {
      securityManager.invalidateSession(token);
    }
    res.clearCookie('solsnipe_session');
    res.json({ success: true, message: 'Logged out successfully' });
  });

  app.post('/api/security/setup', authRateLimiter, (req: Request, res: Response) => {
    const { newCode, currentCode, autoLockMinutes } = req.body;
    const result = securityManager.setupCode({ newCode, currentCode, autoLockMinutes });
    if (result.success && result.token) {
      res.cookie('solsnipe_session', result.token, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: config.AUTO_LOCK_MINUTES > 0 ? config.AUTO_LOCK_MINUTES * 60 * 1000 : undefined,
      });
      broadcast({ type: 'SECURITY_UPDATED', data: securityManager.getStatus() });
    }
    res.json(result);
  });

  app.post('/api/security/toggle', securityManager.requireAuth, authRateLimiter, (req: Request, res: Response) => {
    const { enabled, currentCode } = req.body;
    const result = securityManager.toggleProtection(enabled, currentCode);
    if (result.success) {
      broadcast({ type: 'SECURITY_UPDATED', data: securityManager.getStatus() });
    }
    res.json(result);
  });

  app.post('/api/security/remove', securityManager.requireAuth, authRateLimiter, (req: Request, res: Response) => {
    const { currentCode } = req.body;
    const result = securityManager.removeCode(currentCode);
    if (result.success) {
      res.clearCookie('solsnipe_session');
      broadcast({ type: 'SECURITY_UPDATED', data: securityManager.getStatus() });
    }
    res.json(result);
  });

  app.post('/api/security/autolock', securityManager.requireAuth, authRateLimiter, (req: Request, res: Response) => {
    const { autoLockMinutes } = req.body;
    const result = securityManager.updateAutoLock(Number(autoLockMinutes) || 0);
    broadcast({ type: 'SECURITY_UPDATED', data: securityManager.getStatus() });
    res.json(result);
  });

  // --- SENSITIVE TRADING & WALLET ACTIONS (PROTECTED) ---

  // Config Update
  app.post(
    '/api/config',
    securityManager.requireAuth,
    validateBody(updateConfigSchema),
    (req: Request, res: Response) => {
      const updated = sniperEngine.updateConfig(req.body);
      broadcast({ type: 'CONFIG_UPDATED', data: updated });
      res.json(updated);
    }
  );

  // Manual Token Analysis
  app.post('/api/manual-analyze', async (req: Request, res: Response) => {
    const { address, claimedMarketCap, claimedAge, symbol, tokenName } = req.body;
    if (!address || typeof address !== 'string') {
      res.status(400).json({ error: 'Address is required' });
      return;
    }
    try {
      const report = await gmgnAnalyzer.analyzeToken(address.trim(), {
        claimedMarketCap,
        claimedAge,
        symbol,
        tokenName,
      });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Analysis failed' });
    }
  });

  app.get('/api/tokens/:address/rugcheck', async (req: Request, res: Response) => {
    try {
      const summary = await gmgnAnalyzer.getRugCheckSummary(req.params.address);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dexscreener/:address', async (req: Request, res: Response) => {
    try {
      const pair = await dexscreener.getTokenPair(req.params.address);
      if (!pair) {
        res.status(404).json({ error: 'Pair not found on Dexscreener' });
        return;
      }
      res.json(pair);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual Snipe (Protected + Rate Limited)
  app.post(
    '/api/manual-snipe',
    securityManager.requireAuth,
    snipeRateLimiter,
    validateBody(manualSnipeSchema),
    async (req: Request, res: Response) => {
      const { tokenAddress, amountSol, slippagePercent } = req.body;
      try {
        const report = await gmgnAnalyzer.analyzeToken(tokenAddress);
        const position = await sniperEngine.executeSnipe(report, {
          amountSol: amountSol ? Number(amountSol) : undefined,
          slippagePercent: slippagePercent ? Number(slippagePercent) : undefined,
        });

        broadcast({ type: 'SNIPE_EXECUTED', data: position });
        res.json({ success: true, position });
      } catch (err: any) {
        logger.error('Server', `Manual snipe failed for ${tokenAddress}: ${err.message}`);
        res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  // Sell Position (Protected + Rate Limited)
  app.post(
    '/api/sell-position',
    securityManager.requireAuth,
    sellRateLimiter,
    validateBody(sellPositionSchema),
    async (req: Request, res: Response) => {
      const { positionId, percent, reason } = req.body;
      try {
        const result = await sniperEngine.executeSell(positionId, percent, reason);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  // Update Position Targets (Protected)
  app.post(
    '/api/position/update-targets',
    securityManager.requireAuth,
    validateBody(updateTargetsSchema),
    (req: Request, res: Response) => {
      const { positionId, targets } = req.body;
      const updated = sniperEngine.updatePositionTargets(positionId, targets);
      if (!updated) {
        res.status(404).json({ success: false, error: 'Position not found' });
        return;
      }
      broadcast({ type: 'POSITIONS_UPDATED', data: sniperEngine.getActivePositions() });
      res.json({ success: true, position: updated });
    }
  );

  // Refresh Positions Price Feed (Protected + Rate Limited)
  app.post(
    '/api/positions/refresh',
    securityManager.requireAuth,
    refreshRateLimiter,
    async (req: Request, res: Response) => {
      try {
        await sniperEngine.getPositionManager().trackPricesAndExits();
        const updated = sniperEngine.getActivePositions();
        broadcast({ type: 'POSITIONS_UPDATED', data: updated });
        res.json({ success: true, positions: updated });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // Circuit Breaker Reset (Protected)
  app.post('/api/trading/circuit-breaker/reset', securityManager.requireAuth, (req: Request, res: Response) => {
    sniperEngine.getRiskManager().resetCircuitBreaker();
    broadcast({ type: 'RISK_UPDATED', data: sniperEngine.getRiskManager().getStatus() });
    res.json({ success: true, message: 'Circuit breaker has been reset.' });
  });

  // --- WALLET MANAGEMENT (PROTECTED) ---

  // Import Wallet into Server Memory (NO DISK PERSISTENCE)
  app.post(
    '/api/wallet/import',
    securityManager.requireAuth,
    validateBody(importWalletSchema),
    async (req: Request, res: Response) => {
      const { privateKey } = req.body;
      const result = sniperEngine.getWalletManager().importPrivateKey(privateKey);
      if (result.success) {
        sniperEngine.updateConfig({ walletPublicKey: result.publicKey });
        broadcast({ type: 'WALLET_UPDATED', data: sniperEngine.getWalletManager().getStatus() });
      }
      res.json(result);
    }
  );

  app.post('/api/wallet/refresh-balance', securityManager.requireAuth, async (req: Request, res: Response) => {
    const status = await sniperEngine.refreshWalletBalance();
    broadcast({ type: 'WALLET_UPDATED', data: status });
    res.json(status);
  });

  app.get('/api/wallet/status', securityManager.requireAuth, async (req: Request, res: Response) => {
    const status = sniperEngine.getWalletManager().getStatus();
    res.json(status);
  });

  // SECURITY ENFORCEMENT: Export Private Key is PERMANENTLY DISABLED
  app.get('/api/wallet/export', (req: Request, res: Response) => {
    res.status(400).json({
      success: false,
      error: {
        code: 'PRIVATE_KEY_EXPORT_FORBIDDEN',
        message: 'Private key export is disabled for security reasons. Keys are stored only in server memory.',
      },
    });
  });

  // Helper: Enforce authentication only if an admin security code has been configured
  const requireAuthIfConfigured = (req: Request, res: Response, next: NextFunction) => {
    if (securityManager.getStatus().hasCodeSet) {
      return securityManager.requireAuth(req, res, next);
    }
    next();
  };

  // --- TELEGRAM MANAGEMENT (PROTECTED) ---
  app.post('/api/telegram/add-channel', requireAuthIfConfigured, (req: Request, res: Response) => {
    const { channel } = req.body;
    if (!channel) {
      res.status(400).json({ success: false, error: 'Channel is required' });
      return;
    }
    const success = telegramListener.addChannel(channel);
    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json({ success, channel, channels: telegramListener.getStatus().channels });
  });

  app.post('/api/telegram/remove-channel', requireAuthIfConfigured, (req: Request, res: Response) => {
    const { channel } = req.body;
    if (!channel) {
      res.status(400).json({ success: false, error: 'Channel is required' });
      return;
    }
    const success = telegramListener.removeChannel(channel);
    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json({ success, channel, channels: telegramListener.getStatus().channels });
  });

  app.post('/api/telegram/set-channels', requireAuthIfConfigured, (req: Request, res: Response) => {
    const { channels } = req.body;
    if (!Array.isArray(channels)) {
      res.status(400).json({ success: false, error: 'Channels must be an array' });
      return;
    }
    telegramListener.setChannels(channels);
    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json({ success: true, channels: telegramListener.getStatus().channels });
  });

  app.post('/api/telegram/send-code', requireAuthIfConfigured, telegramRateLimiter, async (req: Request, res: Response) => {
    const { phone, apiId, apiHash } = req.body;
    if (!phone) {
      res.status(400).json({ success: false, error: 'Numéro de téléphone requis' });
      return;
    }
    const result = await telegramListener.sendCode(phone, apiId, apiHash);
    res.json(result);
  });

  app.post('/api/telegram/verify-code', requireAuthIfConfigured, telegramRateLimiter, async (req: Request, res: Response) => {
    const { code, password } = req.body;
    if (!code) {
      res.status(400).json({ success: false, error: 'Code de vérification requis' });
      return;
    }
    const result = await telegramListener.verifyCode(code, password);
    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json(result);
  });

  app.post('/api/telegram/import-session', requireAuthIfConfigured, telegramRateLimiter, async (req: Request, res: Response) => {
    const { sessionString, apiId, apiHash } = req.body;
    if (!sessionString) {
      res.status(400).json({ success: false, error: 'Session string requise' });
      return;
    }
    const result = await telegramListener.importSession(sessionString, apiId, apiHash);
    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json(result);
  });

  app.get('/api/telegram/my-dialogs', requireAuthIfConfigured, async (req: Request, res: Response) => {
    const result = await telegramListener.getMyDialogs();
    res.json(result);
  });

  app.post('/api/telegram/toggle-dialog', requireAuthIfConfigured, (req: Request, res: Response) => {
    const { identifier } = req.body;
    if (!identifier) {
      res.status(400).json({ success: false, error: 'Identifiant du canal requis' });
      return;
    }
    const result = telegramListener.toggleDialogMonitoring(identifier);
    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json(result);
  });

  app.post('/api/telegram/disconnect', requireAuthIfConfigured, async (req: Request, res: Response) => {
    const result = await telegramListener.disconnect();
    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json(result);
  });

  // Force Immediate Telegram Channel Poll
  app.post('/api/telegram/poll-now', requireAuthIfConfigured, async (req: Request, res: Response) => {
    try {
      const result = await telegramListener.pollAllChannels();
      const status = telegramListener.getStatus();
      broadcast({ type: 'TELEGRAM_STATUS', data: status });
      res.json({ success: true, ...result, status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Poll failed' });
    }
  });

  // Inject Custom Telegram Signal (Manual / Test Alert)
  app.post('/api/telegram/inject-call', requireAuthIfConfigured, (req: Request, res: Response) => {
    const { text, channel, tokenAddress, symbol, tokenName, marketCap } = req.body;
    let messageText = (text || '').trim();

    if (!messageText && tokenAddress) {
      messageText = `🚨 ${tokenName || 'TEST TOKEN'} ($${symbol || 'TEST'}) NEW ALERT!\nContract: ${tokenAddress}\nMC: ${marketCap || '$35K'} | Dex: PumpFun`;
    }

    if (!messageText) {
      res.status(400).json({ success: false, error: 'Texte ou tokenAddress requis' });
      return;
    }

    const call = telegramListener.injectCall(messageText, channel || 'manual_test', {
      symbol,
      tokenName,
      marketCap,
    });

    if (!call) {
      res.status(400).json({ success: false, error: 'Aucune adresse de token Solana valide détectée dans le message' });
      return;
    }

    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json({ success: true, call });
  });

  // Generate Sample Pump.fun Volume Alert Call (for testing the GMGN pipeline)
  app.post('/api/telegram/sample-call', requireAuthIfConfigured, async (req: Request, res: Response) => {
    // Pick from recent live tokens or sample
    const sampleMints = [
      { name: 'BONK DOGE', symbol: 'BDOGE', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', mc: '$42.5K' },
      { name: 'PUMP WHALE', symbol: 'WHALE', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', mc: '$28.4K' },
      { name: 'SOL SPEED', symbol: 'SPEED', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', mc: '$35.2K' },
    ];
    const pick = sampleMints[Math.floor(Math.random() * sampleMints.length)];
    const text = `🔥 ${pick.name} ($${pick.symbol}) NEW ALERT!!! 🚨🚨\nLast 3 mins buy: 48 SOL in 35 buys\n${pick.address}\nUSD: $0.000035 (+420%)\nDex: PumpFun\nMC: ${pick.mc} | Vol: $55K | Top 10: 22.4%`;

    const call = telegramListener.injectCall(text, 'pumpdotfunalert', {
      symbol: pick.symbol,
      tokenName: pick.name,
      marketCap: pick.mc,
    });

    broadcast({ type: 'TELEGRAM_STATUS', data: telegramListener.getStatus() });
    res.json({ success: true, call });
  });

  // Centralized Error Handling Middleware
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('ErrorHandler', `Unhandled error on ${req.method} ${req.path}:`, err?.message || err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: config.NODE_ENV === 'production' ? 'An internal server error occurred' : err.message || 'Internal error',
      },
    });
  });

  // 9. Static Assets / Vite Frontend Mounting
  if (config.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 10. Start HTTP Server
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    logger.info('Server', `🚀 Solsnipe Bot running on http://0.0.0.0:${PORT} (${config.NODE_ENV})`);
    logger.info('Server', `🛡️ Security protection: ${securityManager.getStatus().enabled ? 'ENABLED' : 'DISABLED'}`);
    logger.info('Server', 'TRADING MODE: SIMULATION');
    logger.info('Server', 'LIVE TRADING DISABLED');
    logger.info('Server', `⚡ Live trading switch: ${config.LIVE_TRADING_ENABLED ? 'ENABLED' : 'DISABLED (SIMULATION ONLY)'}`);
  });

  // 11. Graceful Process Shutdown Handler
  const shutdown = async (signal: string) => {
    logger.info('Process', `Received ${signal}. Initiating graceful shutdown...`);

    // Stop accepting new connections
    server.close(() => {
      logger.info('Process', 'HTTP server closed.');
    });

    // Stop price tracking loop & save final state
    sniperEngine.getPositionManager().stopPriceTracker();
    sniperEngine.getPositionManager().saveState();

    // Disconnect telegram listener
    await telegramListener.stop();

    logger.info('Process', 'Graceful shutdown completed successfully. Exiting.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  logger.error('Startup', 'Fatal error starting Solsnipe Bot:', err);
  process.exit(1);
});
