export interface GMGNConditionCheck {
  id: string;
  name: string;
  passed: boolean;
  rule: string;
  actualValue: string;
  details: string;
}

export interface RugCheckRisk {
  name: string;
  value?: string;
  description?: string;
  score: number;
  level: 'danger' | 'warn' | 'info';
}

export interface RugCheckSummary {
  score: number; // Raw RugCheck score (0 = safest, 0-499 Good, 500-999 Warn, 1000+ Danger)
  normalizedScore?: number; // 0-100 normalized score
  status: 'good' | 'warn' | 'danger' | 'unknown';
  statusLabel: string;
  rugged: boolean;
  risksCount: number;
  highRisksCount: number;
  warnRisksCount: number;
  risks: RugCheckRisk[];
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  lpLockedPct?: number;
  topHoldersPct?: number;
  tokenProgram?: string;
  detectedAt?: number;
}

export interface GMGNAnalysisReport {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  priceUsd: number;
  marketCapUsd: number;
  volume24hUsd: number;
  volume1hUsd: number;
  top10HoldersPercent: number;
  buyersCount: number;
  sellersCount: number;
  hasDescription: boolean;
  hasWebsite: boolean;
  hasSocial: boolean;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  socialActive: boolean;
  kolCount: number;
  smartWalletCount: number;
  isMintRenounced?: boolean;
  isFreezeRenounced?: boolean;
  isHoneypot?: boolean;
  conditions: GMGNConditionCheck[];
  allPassed: boolean;
  decision: 'SNIPED' | 'REJECTED';
  rejectionReason?: string;
  reasons?: string[];
  geminiAnalysis?: {
    summary: string;
    riskScore: number;
    sentiment: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'HIGH_RISK';
  };
  evaluatedAt: number;
  executionTimeMs?: number;
  sources?: string[];
  rugCheck?: RugCheckSummary;
  rawMetrics?: Record<string, unknown>;
  pairAddress?: string;
  dexId?: string;
}

export interface TelegramCall {
  id: string;
  messageId: number | string;
  channel: string;
  channels?: string[];
  callCount?: number;
  lastAlertTime?: number;
  timestamp: number;
  rawText: string;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  claimedMarketCap?: string;
  claimedAge?: string;
  status: 'PENDING' | 'ANALYZING' | 'SNIPED' | 'REJECTED';
  analysis?: GMGNAnalysisReport;
  rugCheck?: RugCheckSummary;
  error?: string;
  isHistorical?: boolean;
  canAutoSnipe?: boolean;
}

export interface ActivePosition {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  entryPriceUsd: number;
  entryPriceSol: number;
  currentPriceUsd: number;
  currentPriceSol: number;
  peakPriceUsd: number;
  lowestPriceUsd?: number;
  amountSol: number;
  amountTokens: number;
  investedSol?: number;
  investedUsd?: number;
  currentValueUsd?: number;
  unrealizedPnlUsd?: number;
  unrealizedPnlPercent?: number;
  pnlUsd: number;
  pnlSol?: number;
  pnlPercent: number;
  tpPriceUsd: number;
  slPriceUsd: number;
  trailingStopPriceUsd: number;
  tpPercent: number;
  slPercent: number;
  trailingStopPercent: number;
  openedAt: number;
  lastUpdated: number;
  router: 'jupiter' | 'jito' | 'gmgn';
  executionMode: 'simulation' | 'wallet';
  txHash?: string;
  status: 'OPEN' | 'CLOSED';
  exitReason?: string;
  closedAt?: number;
  dexUrl?: string;
  pairAddress?: string;
  dexId?: string;
  volume5mUsd?: number;
  buys5m?: number;
  sells5m?: number;
  autoSellStagnant?: boolean;
  stagnantTimeoutSeconds?: number;
  stagnantThresholdPercent?: number;
  stagnantDetectedAt?: number;
  lastPriceMovementAt?: number;
  lastRecordedPriceUsd?: number;
  isSimulated?: boolean;
}

export interface TradeHistoryItem {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName?: string;
  buyPriceUsd: number;
  sellPriceUsd: number;
  entryPriceUsd?: number;
  exitPriceUsd?: number;
  amountSol: number;
  realizedPnlUsd: number;
  realizedPnlSol?: number;
  realizedPnlPercent: number;
  pnlUsd?: number;
  pnlSol?: number;
  pnlPercent?: number;
  openedAt: number;
  closedAt: number;
  exitReason: string;
  router: string;
  executionMode: 'simulation' | 'wallet';
  txHash?: string;
  isSimulated?: boolean;
}

export interface SniperConfig {
  autoSnipe: boolean;
  tradingAmountSol: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  autoSellStagnant?: boolean;
  stagnantTimeoutSeconds?: number;
  stagnantThresholdPercent?: number;
  slippagePercent: number;
  maxRugCheckScore?: number;
  rejectOnRugCheckDanger?: boolean;
  maxEntryMarketCapUsd?: number;
  maxTokenAgeMinutes?: number;
  requirePositiveMomentum5m?: boolean;
  router: 'jupiter' | 'jito' | 'gmgn';
  executionMode: 'simulation' | 'wallet';
  priorityFeeSol: number;
  jitoTipSol: number;
  walletPublicKey: string;
  hasPrivateKey: boolean;
  walletBalanceSol?: number;
  rpcUrl?: string;
}

export interface SecurityStatus {
  enabled: boolean;
  hasCodeSet: boolean;
  autoLockMinutes: number;
}

export interface TelegramStatus {
  channel: string;
  channels: string[];
  connected: boolean;
  listenerType?: 'live_channel' | 'mtproto' | 'dual';
  totalCallsDetected?: number;
  totalUniqueTokens?: number;
  totalDuplicatesFiltered?: number;
  totalAlertsReceived?: number;
  channelCounts?: Record<string, number>;
  channelStats?: Record<string, number>;
  lastCallTime?: number;
  lastCheckTime?: number;
  lastCheck?: number;
  lastCall?: number;
  totalCalls?: number;
  isPhoneAuthPending?: boolean;
  phone?: string;
  statusMessage?: string;
  isAuthenticated?: boolean;
  authenticated?: boolean;
  authenticatedUser?: string;
  userName?: string;
  phoneCodeSent?: boolean;
  channelErrors?: Record<string, string>;
}

export interface DexscreenerPair {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  volume?: {
    h24?: number;
    h6?: number;
    h1?: number;
    m5?: number;
  };
  priceChange?: {
    m5?: number;
    h1?: number;
    h6?: number;
    h24?: number;
  };
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
}

export interface DailyPerformanceStat {
  date: string; // YYYY-MM-DD
  displayDate: string; // "21 Sep"
  timestamp: number;
  tradesCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number; // percentage 0 - 100
  dailySolProfit: number; // net SOL on this day
  cumulativeSolProfit: number; // running total SOL profit
  dailyUsdProfit: number;
  volumeSol: number;
  callsEvaluated: number;
  callsPassed: number;
  snipingSuccessRate: number; // % of calls passed
}

export interface PerformanceSummary {
  timeframeDays: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winLossRatio: number; // wins / losses
  winRatePercent: number; // (wins / totalTrades) * 100
  totalSolProfit: number;
  totalUsdProfit: number;
  averageSolPerTrade: number;
  profitFactor: number; // Gross gains SOL / Gross losses SOL
  totalSolGains: number;
  totalSolLosses: number;
  bestTradeSol: number;
  worstTradeSol: number;
  bestTradePercent: number;
  worstTradePercent: number;
  bestTradeSymbol: string;
  worstTradeSymbol: string;
  averageWinSol: number;
  averageLossSol: number;
  averageDurationSec: number;
  totalCallsEvaluated: number;
  totalCallsPassed: number;
  overallSnipingPassRate: number;
}

export interface PerformanceStatsResponse {
  days: DailyPerformanceStat[];
  summary: PerformanceSummary;
}
