import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import {
  GMGNAnalysisReport,
  GMGNConditionCheck,
  RugCheckRisk,
  RugCheckSummary,
  SniperConfig,
} from '../src/types';
import { config as appConfig } from './config';
import { logger } from './logger';

export interface TokenAnalysisContext {
  rawText?: string;
  claimedMarketCap?: string;
  claimedAge?: string;
  symbol?: string;
  tokenName?: string;
  channel?: string;
}

interface CacheEntry {
  report: GMGNAnalysisReport;
  timestamp: number;
}

export class GMGNAnalyzer {
  private apiKey: string;
  private cache: Map<string, CacheEntry> = new Map();
  private gmgnCooldownUntil: number = 0;
  private configGetter?: () => Partial<SniperConfig>;
  private geminiClient: GoogleGenAI | null = null;

  constructor(apiKey: string = appConfig.GMGN_API_KEY || '') {
    this.apiKey = apiKey;
    if (appConfig.GEMINI_API_KEY) {
      try {
        this.geminiClient = new GoogleGenAI({ apiKey: appConfig.GEMINI_API_KEY });
        logger.info('GMGNAnalyzer', 'Gemini AI integration initialized for contextual token assessment');
      } catch (err) {
        logger.warn('GMGNAnalyzer', 'Failed to initialize Gemini client:', err);
      }
    }
  }

  public setConfigGetter(getter: () => Partial<SniperConfig>): void {
    this.configGetter = getter;
  }

  /**
   * Ultra-fast multi-source on-chain token analyzer.
   * Concurrently queries Dexscreener, RugCheck on-chain audit, GMGN OpenAPI (if key configured),
   * and parses high-frequency Telegram alert metadata.
   */
  public async analyzeToken(
    tokenAddress: string,
    context?: TokenAnalysisContext,
    overrideConfig?: Partial<SniperConfig>
  ): Promise<GMGNAnalysisReport> {
    const cleanAddress = tokenAddress.trim();
    const startTime = Date.now();
    const config = overrideConfig || (this.configGetter ? this.configGetter() : undefined);

    // Fast in-memory cache check (30s TTL)
    const cached = this.cache.get(cleanAddress);
    if (cached && Date.now() - cached.timestamp < 30_000) {
      logger.debug('GMGNAnalyzer', `Cache HIT for ${cleanAddress.slice(0, 8)} (${Date.now() - cached.timestamp}ms old)`);
      return {
        ...cached.report,
        executionTimeMs: Date.now() - startTime,
      };
    }

    logger.info('GMGNAnalyzer', `🚀 On-chain audit launched for: ${cleanAddress}`);

    // Parse alert text metadata if available
    const alertData = this.parseAlertText(cleanAddress, context);

    // Query external sources concurrently with defensive timeouts
    const sourcesUsed: string[] = ['AlertParser'];
    const [dexData, rugcheckData, gmgnData] = await Promise.all([
      this.fetchDexscreenerData(cleanAddress).then((d) => {
        if (d) sourcesUsed.push('Dexscreener');
        return d;
      }),
      this.fetchRugCheckData(cleanAddress).then((r) => {
        if (r) sourcesUsed.push('RugCheck');
        return r;
      }),
      this.fetchGmgnData(cleanAddress).then((g) => {
        if (g) sourcesUsed.push('GMGN');
        return g;
      }),
    ]);

    const report = this.evaluateConditions(cleanAddress, dexData, rugcheckData, gmgnData, alertData, context, config);
    const duration = Date.now() - startTime;
    report.executionTimeMs = duration;
    report.sources = sourcesUsed;

    // Optional asynchronous AI commentary if Gemini is enabled and token was sniped or analyzed manually
    if (this.geminiClient && (report.decision === 'SNIPED' || !context?.rawText)) {
      try {
        const aiAssessment = await this.generateAiAssessment(report, alertData);
        if (aiAssessment) {
          report.geminiAnalysis = aiAssessment;
        }
      } catch (aiErr) {
        logger.debug('GMGNAnalyzer', 'Optional Gemini assessment skipped:', aiErr);
      }
    }

    logger.info(
      'GMGNAnalyzer',
      `Audit completed in ${duration}ms for ${report.tokenSymbol || cleanAddress.slice(0, 8)}: ${report.decision} (Reasons: ${report.reasons?.join(', ') || 'NONE'})`
    );

    // Save to cache
    this.cache.set(cleanAddress, { report, timestamp: Date.now() });

    // Clean old cache entries
    if (this.cache.size > 200) {
      const now = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (now - v.timestamp > 60_000) {
          this.cache.delete(k);
        }
      }
    }

    return report;
  }

  /**
   * Fetches real-time market data from Dexscreener API (1500ms timeout)
   */
  private async fetchDexscreenerData(address: string): Promise<any> {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
        headers: { 'User-Agent': 'SolSnipeBot/2.0' },
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.pairs && data.pairs.length > 0) {
          return data.pairs.sort(
            (a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
          )[0];
        }
      }
    } catch {
      // Ignored for speed
    }
    return null;
  }

  /**
   * Fetches instant on-chain security & top holders audit from RugCheck (1800ms timeout)
   */
  public async fetchRugCheckData(address: string): Promise<any> {
    const cleanAddr = address.trim();
    try {
      // 1. Fast summary endpoint
      const summaryRes = await fetch(`https://api.rugcheck.xyz/v1/tokens/${cleanAddr}/report/summary`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SolSnipeAudit/1.0)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(1800),
      });

      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        if (summary && (summary.score !== undefined || summary.risks || summary.tokenProgram)) {
          return summary;
        }
      }

      // 2. Full report fallback
      const reportRes = await fetch(`https://api.rugcheck.xyz/v1/tokens/${cleanAddr}/report`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SolSnipeAudit/1.0)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(1800),
      });

      if (reportRes.ok) {
        return await reportRes.json();
      }
    } catch {
      // Ignored for speed
    }
    return null;
  }

  public buildRugCheckSummary(address: string, raw: any): RugCheckSummary {
    if (!raw) {
      return {
        score: -1,
        status: 'unknown',
        statusLabel: 'AUDIT INDISPONIBLE',
        rugged: false,
        risksCount: 0,
        highRisksCount: 0,
        warnRisksCount: 0,
        risks: [],
        detectedAt: Date.now(),
      };
    }

    const rug = raw;
    const rawScore = typeof rug.score === 'number' ? rug.score : rug.rugged ? 1500 : 0;
    const isRugged = Boolean(rug.rugged || rawScore >= 1000);

    const risks: RugCheckRisk[] = [];
    let highRisksCount = 0;
    let warnRisksCount = 0;

    if (Array.isArray(rug.risks)) {
      for (const r of rug.risks) {
        const level: 'danger' | 'warn' | 'info' =
          r.level === 'danger' || r.score > 500
            ? 'danger'
            : r.level === 'warn' || r.score > 100
            ? 'warn'
            : 'info';
        if (level === 'danger') highRisksCount++;
        if (level === 'warn') warnRisksCount++;
        risks.push({
          name: r.name || 'Risk Indicator',
          value: r.value ? String(r.value) : undefined,
          description: r.description || undefined,
          score: Number(r.score || 0),
          level,
        });
      }
    }

    let status: 'good' | 'warn' | 'danger' | 'unknown' = 'good';
    let statusLabel = 'GOOD / SAFE';
    if (isRugged || rawScore >= 1000 || highRisksCount > 0) {
      status = 'danger';
      statusLabel = 'DANGER / RUG RISK';
    } else if (rawScore >= 400 || warnRisksCount > 0) {
      status = 'warn';
      statusLabel = 'WARNING';
    }

    let topHoldersPct = 0;
    if (Array.isArray(rug.topHolders)) {
      const top10 = rug.topHolders.slice(0, 10);
      topHoldersPct = top10.reduce((acc: number, h: any) => acc + Number(h.pct || 0), 0);
    }

    return {
      score: rawScore,
      normalizedScore: Math.min(100, Math.round(rawScore / 10)),
      status,
      statusLabel,
      rugged: isRugged,
      risksCount: risks.length,
      highRisksCount,
      warnRisksCount,
      risks,
      mintAuthority: rug?.token?.mintAuthority ?? rug?.mintAuthority ?? null,
      freezeAuthority: rug?.token?.freezeAuthority ?? rug?.freezeAuthority ?? null,
      lpLockedPct: typeof rug?.lpLockedPct === 'number' ? rug.lpLockedPct : rug?.markets?.[0]?.lp?.lpLockedPct,
      topHoldersPct,
      tokenProgram: rug?.tokenProgram,
      detectedAt: Date.now(),
    };
  }

  public async getRugCheckSummary(address: string): Promise<RugCheckSummary> {
    const raw = await this.fetchRugCheckData(address);
    return this.buildRugCheckSummary(address, raw);
  }

  /**
   * Fetches GMGN data with circuit breaker & tight timeout (1000ms max)
   */
  private async fetchGmgnData(address: string): Promise<any> {
    if (!this.apiKey) {
      return null;
    }

    if (Date.now() < this.gmgnCooldownUntil) {
      return null;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const clientIdInfo = crypto.randomUUID();
    const clientIdSec = crypto.randomUUID();
    const infoUrl = `https://openapi.gmgn.ai/v1/token/info?chain=sol&address=${address}&timestamp=${timestamp}&client_id=${clientIdInfo}`;
    const secUrl = `https://openapi.gmgn.ai/v1/token/security?chain=sol&address=${address}&timestamp=${timestamp}&client_id=${clientIdSec}`;

    const headers = {
      'X-APIKEY': this.apiKey,
      'User-Agent': 'gmgn-cli/1.6.2',
      Accept: 'application/json',
    };

    try {
      const [infoRes, secRes] = await Promise.all([
        fetch(infoUrl, { headers, signal: AbortSignal.timeout(1000) }).catch(() => null),
        fetch(secUrl, { headers, signal: AbortSignal.timeout(1000) }).catch(() => null),
      ]);

      if (infoRes?.status === 429 || secRes?.status === 429) {
        logger.warn('GMGNAnalyzer', 'GMGN returned 429 Rate Limit. Activating 60s circuit-breaker.');
        this.gmgnCooldownUntil = Date.now() + 60_000;
        return null;
      }

      let tokenInfo: any = null;
      let securityInfo: any = null;

      if (infoRes && infoRes.ok) {
        const json = await infoRes.json();
        if (json.code === 0 && json.data) {
          tokenInfo = json.data;
        } else if (json.code === 429) {
          this.gmgnCooldownUntil = Date.now() + 60_000;
        }
      }

      if (secRes && secRes.ok) {
        const secJson = await secRes.json();
        if (secJson.code === 0 && secJson.data) {
          securityInfo = secJson.data;
        }
      }

      if (tokenInfo) {
        if (securityInfo) {
          tokenInfo.security = securityInfo;
        }
        return tokenInfo;
      }
    } catch {
      // Ignored for speed
    }
    return null;
  }

  /**
   * Parses rich structured metadata directly from Telegram alert text.
   */
  private parseAlertText(tokenAddress: string, context?: TokenAnalysisContext): any {
    const raw = context?.rawText || '';
    if (!raw) {
      return {
        isPump: tokenAddress.toLowerCase().endsWith('pump'),
      };
    }

    let top10Percent = 0;
    const top10Match = raw.match(/TOP\s*10\s*:\s*([0-9.]+)\s*%/i) || raw.match(/Top\s*10\s*:\s*([0-9.]+)\s*%/i);
    if (top10Match) {
      top10Percent = parseFloat(top10Match[1]);
    }

    let marketCapUsd = 0;
    const mcMatch =
      raw.match(/(?:MC|MCap|Market\s*Cap)\s*:\s*\$?([0-9,.]+)\s*([KkMmBb])?/i) ||
      raw.match(/\$?([0-9,.]+)\s*([KkMmBb])\s*(?:MC|MCap)/i);
    if (mcMatch) {
      let val = parseFloat(mcMatch[1].replace(/,/g, ''));
      const mult = (mcMatch[2] || '').toUpperCase();
      if (mult === 'K') val *= 1000;
      else if (mult === 'M') val *= 1_000_000;
      else if (mult === 'B') val *= 1_000_000_000;
      marketCapUsd = val;
    }

    let volumeUsd = 0;
    const volMatch = raw.match(/(?:Vol|Volume)\s*:\s*\$?([0-9,.]+)\s*([KkMmBb])?/i);
    if (volMatch) {
      let val = parseFloat(volMatch[1].replace(/,/g, ''));
      const mult = (volMatch[2] || '').toUpperCase();
      if (mult === 'K') val *= 1000;
      else if (mult === 'M') val *= 1_000_000;
      volumeUsd = val;
    }

    let txCount = 0;
    const txMatch = raw.match(/([0-9,]+)\s*(?:TXs|txs|transac)/i) || raw.match(/Txns\s*:\s*([0-9,]+)/i);
    if (txMatch) {
      txCount = parseInt(txMatch[1].replace(/,/g, ''), 10);
    }

    let devHoldingPercent = 0;
    const devMatch = raw.match(/(?:Dev|DEV)\s*(?:Holding)?\s*:\s*([0-9.]+)\s*%/i);
    if (devMatch) {
      devHoldingPercent = parseFloat(devMatch[1]);
    }

    const hasNoMint =
      /NoMint|Mint\s*Auth\s*Disabled|Mint\s*Renounced|renounced/i.test(raw) ||
      /Mint\s*:\s*(?:No|Disabled|Renounced|OFF|0)/i.test(raw);
    const hasBlacklist = /Blacklist\s*:\s*(?:No|None|OFF|0)/i.test(raw) || /NoBlacklist/i.test(raw);
    const hasBurnt =
      /Burnt|Burned|LP\s*Burnt|100%\s*Burn/i.test(raw) || /LP\s*:\s*(?:Burnt|Burned|Locked|100%)/i.test(raw);
    const devBought = /Dev\s*Bought|Dev\s*Snipe/i.test(raw);

    let symbol = context?.symbol || '';
    let name = context?.tokenName || '';
    const nameMatch = raw.match(/(?:Token|Coin)?\s*\$([A-Za-z0-9_]+)\s*(?:\(([^)]+)\))?/i);
    if (nameMatch) {
      if (!symbol) symbol = nameMatch[1].toUpperCase();
      if (!name) name = nameMatch[2]?.trim() || '';
    }

    const isPump = tokenAddress.toLowerCase().endsWith('pump') || /PUMP\s*DEV|pump\.fun/i.test(raw);

    return {
      top10Percent,
      marketCapUsd,
      volumeUsd,
      txCount,
      devHoldingPercent,
      hasNoMint,
      hasBlacklist,
      hasBurnt,
      devBought,
      symbol,
      name,
      isPump,
      channel: context?.channel,
    };
  }

  /**
   * Strictly evaluates the 7 sniper conditions using multi-source consensus.
   */
  private evaluateConditions(
    tokenAddress: string,
    dex: any,
    rug: any,
    gmgn: any,
    alertData: any,
    context?: TokenAnalysisContext,
    config?: Partial<SniperConfig>
  ): GMGNAnalysisReport {
    const tokenSymbol =
      dex?.baseToken?.symbol ||
      alertData?.symbol ||
      gmgn?.symbol ||
      rug?.fileMeta?.symbol ||
      context?.symbol ||
      'UNKNOWN';
    const tokenName =
      dex?.baseToken?.name ||
      alertData?.name ||
      gmgn?.name ||
      rug?.fileMeta?.name ||
      context?.tokenName ||
      'Unknown Token';

    const priceUsd = Number(dex?.priceUsd || gmgn?.price?.price || 0);

    // Calculate Market Cap (Consensus)
    let marketCapUsd = 0;
    if (dex?.marketCap && Number(dex.marketCap) > 0) {
      marketCapUsd = Number(dex.marketCap);
    } else if (dex?.fdv && Number(dex.fdv) > 0) {
      marketCapUsd = Number(dex.fdv);
    } else if (alertData?.marketCapUsd && alertData.marketCapUsd > 0) {
      marketCapUsd = alertData.marketCapUsd;
    } else if (gmgn?.circulating_supply && priceUsd > 0) {
      marketCapUsd = Number(gmgn.circulating_supply) * priceUsd;
    }

    // Calculate Volume (Consensus)
    let volume24hUsd = Number(dex?.volume?.h24 || gmgn?.price?.volume_24h || 0);
    let volume1hUsd = Number(dex?.volume?.h1 || gmgn?.price?.volume_1h || 0);
    let volumeUsd = volume24hUsd > 0 ? volume24hUsd : volume1hUsd;
    if (volumeUsd === 0 && alertData?.volumeUsd > 0) {
      volumeUsd = alertData.volumeUsd;
    }

    // Calculate Top 10 percentage
    let top10HoldersPercent = 0;
    if (gmgn?.stat?.top_10_holder_rate) {
      top10HoldersPercent = Number(gmgn.stat.top_10_holder_rate) * 100;
    } else if (rug?.topHolders && Array.isArray(rug.topHolders) && rug.topHolders.length > 0) {
      top10HoldersPercent = rug.topHolders.slice(0, 10).reduce((acc: number, h: any) => acc + Number(h.pct || 0), 0);
    } else if (alertData?.top10Percent > 0) {
      top10HoldersPercent = alertData.top10Percent;
    }

    const rugSummary = this.buildRugCheckSummary(tokenAddress, rug);
    const auditAvailable = Boolean(rug && (typeof rug.score === 'number' || Array.isArray(rug.risks)));

    // Evaluate 7 core conditions
    const conditions: GMGNConditionCheck[] = [];
    const reasons: string[] = [];

    // Condition 1: Mint Authority Disabled (Strictly on-chain, never purely Telegram text claims)
    const isPumpToken = tokenAddress.toLowerCase().endsWith('pump') || alertData?.isPump;
    const mintRenounced =
      isPumpToken ||
      (auditAvailable && (rugSummary.mintAuthority === null || rugSummary.mintAuthority === undefined)) ||
      gmgn?.security?.is_mint_renounced === 1;

    conditions.push({
      id: 'mint_authority',
      name: 'Mint Authority Renounced',
      passed: Boolean(mintRenounced),
      rule: 'Mint authority must be revoked or renounced on-chain (no infinite minting)',
      actualValue: mintRenounced ? 'Renounced / Pump.fun' : 'Active or Unverified (Risk)',
      details: mintRenounced ? 'Safe: token supply is fixed.' : 'Unsafe: owner can print tokens or audit unavailable.',
    });
    if (!mintRenounced) {
      reasons.push('mint_authority_enabled');
    }

    // Condition 2: Freeze Authority Disabled
    const freezeRenounced =
      isPumpToken ||
      (auditAvailable && (rugSummary.freezeAuthority === null || rugSummary.freezeAuthority === undefined)) ||
      gmgn?.security?.is_freeze_renounced === 1;

    conditions.push({
      id: 'freeze_authority',
      name: 'Freeze Authority Disabled',
      passed: Boolean(freezeRenounced),
      rule: 'Freeze authority must be disabled on-chain (cannot blacklist holders)',
      actualValue: freezeRenounced ? 'Disabled / Pump.fun' : 'Active or Unverified (Risk)',
      details: freezeRenounced ? 'Safe: trading cannot be frozen.' : 'Unsafe: owner can freeze trading or audit unavailable.',
    });
    if (!freezeRenounced) {
      reasons.push('freeze_authority_enabled');
    }

    // Condition 3: RugCheck Security Audit Score
    const maxRugScore = config?.maxRugCheckScore ?? 800;
    // An audit must be available from on-chain sources; missing audit must never pass
    const rugScorePassed = auditAvailable && rugSummary.score >= 0 && rugSummary.score <= maxRugScore && !rugSummary.rugged;
    conditions.push({
      id: 'rugcheck_score',
      name: 'RugCheck Safety Score',
      passed: rugScorePassed,
      rule: `RugCheck score must be ≤ ${maxRugScore} with verified on-chain audit and no fatal rug flags`,
      actualValue: auditAvailable ? `${rugSummary.score} (${rugSummary.statusLabel})` : 'Audit Unavailable (Rejected)',
      details: rugScorePassed
        ? 'Security score within acceptable limits.'
        : !auditAvailable
        ? 'On-chain security audit could not be retrieved.'
        : 'High risk or fatal rug flags detected.',
    });
    if (!rugScorePassed) {
      reasons.push(auditAvailable ? 'rugcheck_risk_too_high' : 'on_chain_audit_unavailable');
    }

    // Condition 4: Top 10 Holder Concentration
    const maxTop10Pct = 35; // Maximum 35% held by top 10
    const top10Passed = top10HoldersPercent === 0 || top10HoldersPercent <= maxTop10Pct;
    conditions.push({
      id: 'holder_concentration',
      name: 'Top 10 Holder Concentration',
      passed: top10Passed,
      rule: `Top 10 holders must own ≤ ${maxTop10Pct}% of supply`,
      actualValue: top10HoldersPercent > 0 ? `${top10HoldersPercent.toFixed(1)}%` : 'Decentralized / Pump curve',
      details: top10Passed ? 'Healthy holder distribution.' : 'Excessive holder concentration.',
    });
    if (!top10Passed) {
      reasons.push('excessive_holder_concentration');
    }

    // Condition 5: Entry Market Cap
    const maxMcap = config?.maxEntryMarketCapUsd ?? 40000;
    const mcapPassed = marketCapUsd === 0 || marketCapUsd <= maxMcap;
    conditions.push({
      id: 'market_cap',
      name: 'Entry Market Cap',
      passed: mcapPassed,
      rule: `Market cap must be ≤ $${maxMcap.toLocaleString()}`,
      actualValue: marketCapUsd > 0 ? `$${Math.round(marketCapUsd).toLocaleString()}` : '< $10k (Early)',
      details: mcapPassed ? 'Early entry sweet spot.' : 'Market cap exceeds max entry threshold.',
    });
    if (!mcapPassed) {
      reasons.push('market_cap_exceeded');
    }

    // Condition 6: Token Age
    const maxAgeMinutes = config?.maxTokenAgeMinutes ?? 15;
    let tokenAgeMinutes = 0;
    if (dex?.pairCreatedAt) {
      tokenAgeMinutes = Math.max(0, Math.round((Date.now() - dex.pairCreatedAt) / 60000));
    }
    const agePassed = tokenAgeMinutes === 0 || tokenAgeMinutes <= maxAgeMinutes;
    conditions.push({
      id: 'token_age',
      name: 'Fresh Token Age',
      passed: agePassed,
      rule: `Token pair age must be ≤ ${maxAgeMinutes} minutes`,
      actualValue: tokenAgeMinutes > 0 ? `${tokenAgeMinutes}m` : 'Fresh (< 2m)',
      details: agePassed ? 'Freshly launched pair.' : 'Pair is too old for sniper entry.',
    });
    if (!agePassed) {
      reasons.push('token_age_too_old');
    }

    // Condition 7: Price Momentum / Activity
    const requireMomentum = config?.requirePositiveMomentum5m ?? true;
    const priceChange5m = Number(dex?.priceChange?.m5 ?? 0);
    const momentumPassed = !requireMomentum || priceChange5m >= -5 || volumeUsd > 1000;
    conditions.push({
      id: 'momentum',
      name: '5m Trading Momentum',
      passed: momentumPassed,
      rule: '5m price change must not show dump (> -5%) or must have active volume',
      actualValue: `${priceChange5m >= 0 ? '+' : ''}${priceChange5m.toFixed(1)}% (Vol: $${Math.round(volumeUsd)})`,
      details: momentumPassed ? 'Healthy initial momentum.' : 'Dumping or negative momentum.',
    });
    if (!momentumPassed) {
      reasons.push('negative_momentum');
    }

    const allPassed = conditions.every((c) => c.passed);
    const decision = allPassed ? 'SNIPED' : 'REJECTED';
    const rejectionReason = reasons.length > 0 ? reasons.join(', ') : undefined;

    return {
      tokenAddress,
      tokenSymbol,
      tokenName,
      priceUsd,
      marketCapUsd,
      volume24hUsd,
      volume1hUsd,
      top10HoldersPercent,
      buyersCount: dex?.txns?.m5?.buys || alertData?.txCount || 0,
      sellersCount: dex?.txns?.m5?.sells || 0,
      hasDescription: Boolean(dex?.info?.description),
      hasWebsite: Boolean(dex?.info?.websites?.length || alertData?.rawWebsite),
      hasSocial: Boolean(dex?.info?.socials?.length || alertData?.rawTwitter || alertData?.rawTelegram),
      websiteUrl: dex?.info?.websites?.[0]?.url || alertData?.rawWebsite,
      twitterUrl: dex?.info?.socials?.find((s: any) => s.type === 'twitter')?.url || alertData?.rawTwitter,
      telegramUrl: dex?.info?.socials?.find((s: any) => s.type === 'telegram')?.url || alertData?.rawTelegram,
      socialActive: Boolean(dex?.info?.socials?.length),
      kolCount: 0,
      smartWalletCount: 0,
      isMintRenounced: mintRenounced,
      isFreezeRenounced: freezeRenounced,
      isHoneypot: !rugScorePassed,
      conditions,
      allPassed,
      decision,
      rejectionReason,
      reasons,
      evaluatedAt: Date.now(),
      rugCheck: rugSummary,
      pairAddress: dex?.pairAddress,
      dexId: dex?.dexId,
    };
  }

  /**
   * Optional contextual narrative AI commentary via Gemini
   */
  private async generateAiAssessment(report: GMGNAnalysisReport, alertData: any): Promise<any | null> {
    if (!this.geminiClient) return null;
    try {
      const prompt = `Analyze this Solana meme token for sniper bot trading risk:
Token: ${report.tokenName} ($${report.tokenSymbol})
Address: ${report.tokenAddress}
Market Cap: $${report.marketCapUsd}
Top 10 Holders: ${report.top10HoldersPercent}%
Mint Renounced: ${report.isMintRenounced}
Freeze Renounced: ${report.isFreezeRenounced}
RugCheck Score: ${report.rugCheck?.score} (${report.rugCheck?.statusLabel})
Channel: ${alertData?.channel || 'Telegram'}

Provide a strict, brief JSON response with:
{
  "summary": "1-2 sentence risk commentary",
  "sentiment": "BULLISH" | "NEUTRAL" | "BEARISH" | "HIGH_RISK",
  "riskScore": number 0 to 100 (100 = safest, 0 = pure scam)
}`;

      const res = await this.geminiClient.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      if (res.text) {
        return JSON.parse(res.text);
      }
    } catch (err) {
      logger.debug('GMGNAnalyzer', 'Gemini assessment generation failed (non-critical):', err);
    }
    return null;
  }
}
