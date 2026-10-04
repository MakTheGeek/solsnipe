import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from '../api';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Percent,
  Coins,
  BarChart3,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  RefreshCw,
  Award,
  ShieldCheck,
  Clock,
  Activity,
  Layers,
} from 'lucide-react';
import {
  DailyPerformanceStat,
  PerformanceStatsResponse,
  PerformanceSummary,
  TradeHistoryItem,
  TelegramCall,
} from '../types';

interface SniperStatsProps {
  history: TradeHistoryItem[];
  calls?: TelegramCall[];
}

const PIE_COLORS = {
  wins: '#10b981', // emerald-500
  losses: '#f43f5e', // rose-500
  breakeven: '#71717a', // zinc-500
};

export const SniperStats: React.FC<SniperStatsProps> = ({ history, calls = [] }) => {
  const [timeframe, setTimeframe] = useState<number>(30);
  const [statsData, setStatsData] = useState<PerformanceStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [lastRefreshed, setLastRefreshed] = useState<number>(Date.now());

  // Fetch or calculate stats for selected timeframe
  const fetchStats = async (days = timeframe) => {
    setIsLoading(true);
    try {
      const res = await authFetch(`/api/stats?days=${days}`);
      if (res.ok) {
        const data = await res.json();
        setStatsData(data);
        setLastRefreshed(Date.now());
      } else {
        fallbackClientCompute(days);
      }
    } catch {
      fallbackClientCompute(days);
    } finally {
      setIsLoading(false);
    }
  };

  // Fallback client-side computation from `history` prop if API is momentarily unreachable
  const fallbackClientCompute = (daysCount: number) => {
    const now = Date.now();
    const DAY_MS = 86400000;
    const startTime = now - daysCount * DAY_MS;
    const relevantTrades = history.filter((t) => (t.closedAt || t.openedAt) >= startTime);

    const days: DailyPerformanceStat[] = [];
    let cumulativeSol = 0;
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

    for (let i = daysCount - 1; i >= 0; i--) {
      const slotTime = now - i * DAY_MS;
      const d = new Date(slotTime);
      const dateStr = d.toISOString().split('T')[0];
      const displayDate = `${d.getDate()} ${monthNames[d.getMonth()]}`;

      const dayStart = new Date(dateStr + 'T00:00:00.000Z').getTime();
      const dayEnd = dayStart + DAY_MS;

      const dayTrades = relevantTrades.filter((t) => {
        const time = t.closedAt || t.openedAt;
        return time >= dayStart && time < dayEnd;
      });

      let dayWins = 0;
      let dayLosses = 0;
      let dayEven = 0;
      let daySolProfit = 0;
      let dayUsdProfit = 0;
      let volumeSol = 0;

      for (const t of dayTrades) {
        volumeSol += t.amountSol || 0;
        const pnlPercent = t.realizedPnlPercent || 0;
        const pnlSol =
          t.realizedPnlSol !== undefined
            ? t.realizedPnlSol
            : ((t.amountSol || 0.1) * pnlPercent) / 100;
        daySolProfit += pnlSol;
        const usdProfit =
          t.realizedPnlUsd !== undefined && Math.abs(t.realizedPnlUsd) > 0.001
            ? t.realizedPnlUsd
            : pnlSol * 117.14;
        dayUsdProfit += usdProfit;

        if (pnlPercent > 0.01) dayWins++;
        else if (pnlPercent < -0.01) dayLosses++;
        else dayEven++;
      }

      cumulativeSol += daySolProfit;
      const dayTradeTotal = dayTrades.length;
      const winRate = dayTradeTotal > 0 ? (dayWins / dayTradeTotal) * 100 : 0;

      days.push({
        date: dateStr,
        displayDate,
        timestamp: dayStart,
        tradesCount: dayTradeTotal,
        wins: dayWins,
        losses: dayLosses,
        breakeven: dayEven,
        winRate: Number(winRate.toFixed(1)),
        dailySolProfit: Number(daySolProfit.toFixed(4)),
        cumulativeSolProfit: Number(cumulativeSol.toFixed(4)),
        dailyUsdProfit: Number(dayUsdProfit.toFixed(2)),
        volumeSol: Number(volumeSol.toFixed(3)),
        callsEvaluated: dayTradeTotal * 3,
        callsPassed: dayTradeTotal,
        snipingSuccessRate: Number(winRate.toFixed(1)),
      });
    }

    let totalWins = 0;
    let totalLosses = 0;
    let totalBreakeven = 0;
    let totalSolProfit = 0;
    let totalUsdProfit = 0;
    let totalSolGains = 0;
    let totalSolLosses = 0;
    let bestTradeSol = -Infinity;
    let worstTradeSol = Infinity;
    let bestTradePercent = -Infinity;
    let worstTradePercent = Infinity;
    let bestTradeSymbol = '';
    let worstTradeSymbol = '';
    let sumDurationSec = 0;

    for (const t of relevantTrades) {
      const pnlPercent = t.realizedPnlPercent || 0;
      const pnlSol =
        t.realizedPnlSol !== undefined
          ? t.realizedPnlSol
          : ((t.amountSol || 0.1) * pnlPercent) / 100;
      totalSolProfit += pnlSol;
      const usdProfit =
        t.realizedPnlUsd !== undefined && Math.abs(t.realizedPnlUsd) > 0.001
          ? t.realizedPnlUsd
          : pnlSol * 117.14;
      totalUsdProfit += usdProfit;

      const dur = Math.max(1, Math.round(((t.closedAt || 0) - (t.openedAt || 0)) / 1000));
      sumDurationSec += dur;

      if (pnlSol > bestTradeSol) {
        bestTradeSol = pnlSol;
        bestTradePercent = pnlPercent;
        bestTradeSymbol = t.tokenSymbol;
      }
      if (pnlSol < worstTradeSol) {
        worstTradeSol = pnlSol;
        worstTradePercent = pnlPercent;
        worstTradeSymbol = t.tokenSymbol;
      }

      if (pnlPercent > 0.01) {
        totalWins++;
        totalSolGains += pnlSol;
      } else if (pnlPercent < -0.01) {
        totalLosses++;
        totalSolLosses += Math.abs(pnlSol);
      } else {
        totalBreakeven++;
      }
    }

    const totalTrades = relevantTrades.length;
    const winRatePercent = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const winLossRatio = totalLosses > 0 ? totalWins / totalLosses : totalWins;
    const profitFactor = totalSolLosses > 0 ? totalSolGains / totalSolLosses : totalSolGains > 0 ? 99 : 0;
    const averageSolPerTrade = totalTrades > 0 ? totalSolProfit / totalTrades : 0;
    const averageWinSol = totalWins > 0 ? totalSolGains / totalWins : 0;
    const averageLossSol = totalLosses > 0 ? totalSolLosses / totalLosses : 0;
    const averageDurationSec = totalTrades > 0 ? Math.round(sumDurationSec / totalTrades) : 0;

    const summary: PerformanceSummary = {
      timeframeDays: daysCount,
      totalTrades,
      wins: totalWins,
      losses: totalLosses,
      breakeven: totalBreakeven,
      winLossRatio: Number(winLossRatio.toFixed(2)),
      winRatePercent: Number(winRatePercent.toFixed(1)),
      totalSolProfit: Number(totalSolProfit.toFixed(4)),
      totalUsdProfit: Number(totalUsdProfit.toFixed(2)),
      averageSolPerTrade: Number(averageSolPerTrade.toFixed(4)),
      profitFactor: Number(profitFactor.toFixed(2)),
      totalSolGains: Number(totalSolGains.toFixed(4)),
      totalSolLosses: Number(totalSolLosses.toFixed(4)),
      bestTradeSol: bestTradeSol === -Infinity ? 0 : Number(bestTradeSol.toFixed(4)),
      worstTradeSol: worstTradeSol === Infinity ? 0 : Number(worstTradeSol.toFixed(4)),
      bestTradePercent: bestTradePercent === -Infinity ? 0 : Number(bestTradePercent.toFixed(1)),
      worstTradePercent: worstTradePercent === Infinity ? 0 : Number(worstTradePercent.toFixed(1)),
      bestTradeSymbol: bestTradeSymbol || '-',
      worstTradeSymbol: worstTradeSymbol || '-',
      averageWinSol: Number(averageWinSol.toFixed(4)),
      averageLossSol: Number(averageLossSol.toFixed(4)),
      averageDurationSec,
      totalCallsEvaluated: totalTrades * 3,
      totalCallsPassed: totalTrades,
      overallSnipingPassRate: Number(winRatePercent.toFixed(1)),
    };

    setStatsData({ days, summary });
  };

  useEffect(() => {
    fetchStats(timeframe);
  }, [timeframe, history.length]);

  const summary = statsData?.summary;
  const days = statsData?.days || [];

  // Donut chart data for Win / Loss / Breakeven
  const pieData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'Victoires (Wins)', value: summary.wins, color: PIE_COLORS.wins },
      { name: 'Défaites (Losses)', value: summary.losses, color: PIE_COLORS.losses },
      { name: 'Breakeven (Neutre)', value: summary.breakeven, color: PIE_COLORS.breakeven },
    ].filter((item) => item.value > 0);
  }, [summary]);

  const activeDaysCount = useMemo(() => {
    return days.filter((d) => d.tradesCount > 0).length;
  }, [days]);

  return (
    <div id="sniper_stats_container" className="space-y-6">
      {/* Top Banner & Timeframe Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-lg bg-zinc-950/80 border border-zinc-900">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-bold text-white font-mono uppercase tracking-wide">
              Statistiques & Performance de Sniping
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-950/70 text-emerald-300 border border-emerald-800/50">
              Live Tracker
            </span>
          </div>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Analyse détaillée des taux de réussite journaliers, profits SOL cumulés et ratio W/L sur les {timeframe} derniers jours.
          </p>
        </div>

        {/* Timeframe Buttons & Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-900 p-0.5 rounded border border-zinc-800">
            {[7, 14, 30].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTimeframe(t)}
                className={`px-3 py-1 text-xs font-mono font-semibold rounded transition-colors cursor-pointer ${
                  timeframe === t
                    ? 'bg-white text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t}J
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fetchStats(timeframe)}
            disabled={isLoading}
            title="Rafraîchir les statistiques"
            className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4 Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total SOL Profit */}
        <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
              Profit Net SOL ({timeframe}J)
            </span>
            <div className="p-1.5 rounded bg-emerald-950/50 border border-emerald-900/40 text-emerald-400">
              <Coins className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3">
            <div
              className={`text-2xl font-bold font-mono tracking-tight ${
                (summary?.totalSolProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {(summary?.totalSolProfit ?? 0) >= 0 ? '+' : ''}
              {(summary?.totalSolProfit ?? 0).toFixed(4)} SOL
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mt-1">
              <span>
                {(summary?.totalUsdProfit ?? 0) >= 0 ? '+' : ''}$
                {(summary?.totalUsdProfit ?? 0).toFixed(2)} USD
              </span>
              <span className="text-[11px] text-zinc-500">
                Moy. {((summary?.averageSolPerTrade ?? 0) >= 0 ? '+' : '')}{(summary?.averageSolPerTrade ?? 0).toFixed(4)} SOL/trade
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Win / Loss Ratio */}
        <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
              Ratio Win / Loss
            </span>
            <div className="p-1.5 rounded bg-sky-950/50 border border-sky-900/40 text-sky-400">
              <Target className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              {(summary?.winLossRatio ?? 0).toFixed(2)} : 1
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mt-1">
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-400 font-semibold">{summary?.wins ?? 0}W</span>
                <span className="text-zinc-600">/</span>
                <span className="text-rose-400 font-semibold">{summary?.losses ?? 0}L</span>
                {Boolean(summary?.breakeven) && (
                  <>
                    <span className="text-zinc-600">/</span>
                    <span className="text-zinc-400">{summary?.breakeven} BE</span>
                  </>
                )}
              </div>
              <span className="text-[11px] text-zinc-500">
                Facteur: {(summary?.profitFactor ?? 0).toFixed(2)}x
              </span>
            </div>
          </div>
        </div>

        {/* KPI 3: Daily Sniping Success Rate */}
        <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
              Taux de Réussite Global
            </span>
            <div className="p-1.5 rounded bg-emerald-950/50 border border-emerald-900/40 text-emerald-400">
              <Percent className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              {(summary?.winRatePercent ?? 0).toFixed(1)}%
            </div>
            {/* Visual mini progress bar */}
            <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-2 flex">
              <div
                style={{ width: `${Math.min(100, summary?.winRatePercent ?? 0)}%` }}
                className="bg-emerald-500 h-full"
              />
              <div
                style={{
                  width: `${Math.max(
                    0,
                    100 - (summary?.winRatePercent ?? 0)
                  )}%`,
                }}
                className="bg-rose-500/80 h-full"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mt-1">
              <span>Seuil 50%: {(summary?.winRatePercent ?? 0) >= 50 ? 'Rentable' : 'Déficitaire'}</span>
              <span className="text-zinc-500">{activeDaysCount} jours actifs</span>
            </div>
          </div>
        </div>

        {/* KPI 4: Total Trades Executed */}
        <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
              Activité de Sniping
            </span>
            <div className="p-1.5 rounded bg-purple-950/50 border border-purple-900/40 text-purple-400">
              <Activity className="w-4 h-4" />
            </div>
          </div>

          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              {summary?.totalTrades ?? 0} Snipes
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mt-1">
              <span>Durée moy: ~{summary?.averageDurationSec ?? 0}s</span>
              <span className="text-[11px] text-zinc-500">
                Filtre 7 cond. actif
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CHART 1: Daily Sniping Success Rate */}
        <div className="p-5 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wide">
                  Taux de Réussite Journalier ({timeframe}J)
                </h3>
              </div>
              <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                Pourcentage de snipes clôturés en profit par jour avec volume de trades
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold text-emerald-400">
                {(summary?.winRatePercent ?? 0).toFixed(1)}% Moy.
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={days}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="successRateGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="displayDate"
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="left"
                  stroke="#71717a"
                  fontSize={10}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#71717a"
                  fontSize={10}
                  domain={[0, 'dataMax + 2']}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as DailyPerformanceStat;
                      return (
                        <div className="p-3 bg-black/95 border border-zinc-800 rounded shadow-xl text-xs font-mono space-y-1.5 min-w-[180px]">
                          <div className="text-white font-bold border-b border-zinc-800 pb-1 flex justify-between">
                            <span>{label}</span>
                            <span className="text-zinc-400">{data.date}</span>
                          </div>
                          <div className="flex justify-between text-zinc-300">
                            <span>Taux de Succès:</span>
                            <span
                              className={`font-bold ${
                                data.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {data.tradesCount > 0 ? `${data.winRate}%` : 'Aucun trade'}
                            </span>
                          </div>
                          <div className="flex justify-between text-zinc-400 text-[11px]">
                            <span>Trades Clôturés:</span>
                            <span className="text-white font-bold">{data.tradesCount}</span>
                          </div>
                          <div className="flex justify-between text-zinc-400 text-[11px]">
                            <span>Gagnants / Perdants:</span>
                            <span>
                              <strong className="text-emerald-400">{data.wins}W</strong> -{' '}
                              <strong className="text-rose-400">{data.losses}L</strong>
                              {data.breakeven > 0 && ` (${data.breakeven} BE)`}
                            </span>
                          </div>
                          <div className="flex justify-between text-zinc-400 text-[11px] pt-1 border-t border-zinc-900">
                            <span>PnL SOL du jour:</span>
                            <span
                              className={`font-bold ${
                                data.dailySolProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {data.dailySolProfit >= 0 ? '+' : ''}
                              {data.dailySolProfit.toFixed(4)} SOL
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine
                  yAxisId="left"
                  y={50}
                  stroke="#52525b"
                  strokeDasharray="4 4"
                  label={{
                    value: 'Seuil 50%',
                    fill: '#71717a',
                    fontSize: 9,
                    position: 'insideTopLeft',
                  }}
                />
                <Bar
                  yAxisId="right"
                  dataKey="tradesCount"
                  name="Volume Snipes"
                  fill="#3f3f46"
                  radius={[3, 3, 0, 0]}
                  barSize={8}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="winRate"
                  name="Taux de Réussite %"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#successRateGrad)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pt-3 border-t border-zinc-900 mt-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 bg-emerald-500 rounded-sm" />
              <span>Taux de Réussite (%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 bg-zinc-600 rounded-sm" />
              <span>Trades du jour</span>
            </div>
          </div>
        </div>

        {/* CHART 2: Total SOL Profit & Daily PnL Evolution */}
        <div className="p-5 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wide">
                  Profit SOL Cumulé & Journalier ({timeframe}J)
                </h3>
              </div>
              <p className="text-[11px] font-mono text-zinc-400 mt-0.5">
                Courbe d'équité en SOL et barres de gains/pertes nets par jour
              </p>
            </div>
            <div className="text-right">
              <span
                className={`text-xs font-mono font-bold ${
                  (summary?.totalSolProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {(summary?.totalSolProfit ?? 0) >= 0 ? '+' : ''}
                {(summary?.totalSolProfit ?? 0).toFixed(4)} SOL
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={days}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="solProfitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="displayDate"
                  stroke="#71717a"
                  fontSize={10}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="left"
                  stroke="#71717a"
                  fontSize={10}
                  tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`}
                  tickLine={false}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload as DailyPerformanceStat;
                      return (
                        <div className="p-3 bg-black/95 border border-zinc-800 rounded shadow-xl text-xs font-mono space-y-1.5 min-w-[200px]">
                          <div className="text-white font-bold border-b border-zinc-800 pb-1 flex justify-between">
                            <span>{label}</span>
                            <span className="text-zinc-400">{data.date}</span>
                          </div>
                          <div className="flex justify-between text-zinc-300">
                            <span>PnL SOL Journalier:</span>
                            <span
                              className={`font-bold ${
                                data.dailySolProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {data.dailySolProfit >= 0 ? '+' : ''}
                              {data.dailySolProfit.toFixed(4)} SOL
                            </span>
                          </div>
                          <div className="flex justify-between text-zinc-300">
                            <span>Profit SOL Cumulé:</span>
                            <span
                              className={`font-bold ${
                                data.cumulativeSolProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {data.cumulativeSolProfit >= 0 ? '+' : ''}
                              {data.cumulativeSolProfit.toFixed(4)} SOL
                            </span>
                          </div>
                          <div className="flex justify-between text-zinc-400 text-[11px]">
                            <span>PnL USD du jour:</span>
                            <span>
                              {data.dailyUsdProfit >= 0 ? '+' : ''}${data.dailyUsdProfit.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-zinc-400 text-[11px] pt-1 border-t border-zinc-900">
                            <span>Trades ce jour:</span>
                            <span className="text-white">
                              {data.tradesCount} ({data.wins}W / {data.losses}L)
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <ReferenceLine yAxisId="left" y={0} stroke="#52525b" strokeDasharray="3 3" />
                <Bar yAxisId="left" dataKey="dailySolProfit" name="PnL SOL Jour" barSize={7}>
                  {days.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.dailySolProfit >= 0 ? '#10b981' : '#f43f5e'}
                    />
                  ))}
                </Bar>
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="cumulativeSolProfit"
                  name="Cumul SOL"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#solProfitGrad)"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pt-3 border-t border-zinc-900 mt-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 bg-sky-400 rounded-sm" />
              <span>Profit SOL Cumulé</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 bg-emerald-500 rounded-sm" />
                <span>Gain Jour</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 bg-rose-500 rounded-sm" />
                <span>Perte Jour</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Win/Loss Ratio Breakdown & Trade Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Win/Loss Donut Chart */}
        <div className="p-5 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wide">
                Répartition Win / Loss
              </h3>
            </div>
            <p className="text-[11px] font-mono text-zinc-400">
              Distribution des issues de positions sur les {timeframe} derniers jours
            </p>
          </div>

          <div className="h-56 w-full relative flex items-center justify-center my-2">
            {pieData.length === 0 ? (
              <div className="text-center text-xs font-mono text-zinc-500">
                Aucune donnée de trade pour cette période
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`slice-${index}`} fill={entry.color} stroke="#09090b" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0];
                          const total = summary?.totalTrades || 1;
                          const pct = ((Number(item.value) / total) * 100).toFixed(1);
                          return (
                            <div className="p-2.5 bg-black border border-zinc-800 rounded text-xs font-mono">
                              <span className="font-bold text-white">{item.name}</span>
                              <div className="text-zinc-400 mt-0.5">
                                {item.value} trades ({pct}%)
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Central W/L ratio label */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold font-mono text-white">
                    {(summary?.winLossRatio ?? 0).toFixed(2)}:1
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                    Ratio W/L
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Legend and count pills */}
          <div className="space-y-1.5 pt-3 border-t border-zinc-900 text-xs font-mono">
            <div className="flex items-center justify-between text-zinc-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span>Victoires (Gains &gt; 0%)</span>
              </div>
              <span className="font-bold text-emerald-400">
                {summary?.wins ?? 0} ({(((summary?.wins ?? 0) / (summary?.totalTrades || 1)) * 100).toFixed(1)}%)
              </span>
            </div>

            <div className="flex items-center justify-between text-zinc-300">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                <span>Défaites (Pertes &lt; 0%)</span>
              </div>
              <span className="font-bold text-rose-400">
                {summary?.losses ?? 0} ({(((summary?.losses ?? 0) / (summary?.totalTrades || 1)) * 100).toFixed(1)}%)
              </span>
            </div>

            {Boolean(summary?.breakeven) && (
              <div className="flex items-center justify-between text-zinc-400">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
                  <span>Breakeven (Neutre)</span>
                </div>
                <span className="font-bold text-zinc-400">
                  {summary?.breakeven} ({(((summary?.breakeven ?? 0) / (summary?.totalTrades || 1)) * 100).toFixed(1)}%)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Trade Quality & Risk/Reward Insights */}
        <div className="p-5 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wide">
                Qualité des Trades & Ratios
              </h3>
            </div>
            <p className="text-[11px] font-mono text-zinc-400">
              Moyennes des gains vs pertes et facteur de rentabilité
            </p>
          </div>

          <div className="space-y-4 my-auto py-2">
            {/* Average Win vs Average Loss */}
            <div className="p-3 rounded bg-zinc-900/60 border border-zinc-850">
              <div className="flex justify-between items-center text-xs font-mono mb-1">
                <span className="text-zinc-400">Gain Moyen / Victoire:</span>
                <span className="text-emerald-400 font-bold">
                  +{(summary?.averageWinSol ?? 0).toFixed(4)} SOL
                </span>
              </div>
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-zinc-400">Perte Moyenne / Défaite:</span>
                <span className="text-rose-400 font-bold">
                  -{(summary?.averageLossSol ?? 0).toFixed(4)} SOL
                </span>
              </div>
            </div>

            {/* Profit Factor */}
            <div className="p-3 rounded bg-zinc-900/60 border border-zinc-850">
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-zinc-400">Facteur de Profit (Profit Factor):</span>
                <span
                  className={`font-bold text-sm ${
                    (summary?.profitFactor ?? 0) >= 1.5
                      ? 'text-emerald-400'
                      : (summary?.profitFactor ?? 0) >= 1.0
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {(summary?.profitFactor ?? 0).toFixed(2)}x
                </span>
              </div>
              <p className="text-[10px] font-mono text-zinc-500 mt-1">
                Total gains SOL ({(summary?.totalSolGains ?? 0).toFixed(3)}) ÷ Total pertes SOL ({(summary?.totalSolLosses ?? 0).toFixed(3)})
              </p>
            </div>

            {/* Extreme trades */}
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded bg-emerald-950/30 border border-emerald-900/30">
                <div className="text-[10px] text-zinc-400 uppercase">Meilleur Snipe</div>
                <div className="text-emerald-400 font-bold mt-0.5 truncate">
                  ${summary?.bestTradeSymbol}
                </div>
                <div className="text-[11px] text-emerald-300 font-semibold">
                  +{(summary?.bestTradePercent ?? 0).toFixed(1)}% (+{(summary?.bestTradeSol ?? 0).toFixed(3)} SOL)
                </div>
              </div>

              <div className="p-2.5 rounded bg-rose-950/30 border border-rose-900/30">
                <div className="text-[10px] text-zinc-400 uppercase">Pire Snipe</div>
                <div className="text-rose-400 font-bold mt-0.5 truncate">
                  ${summary?.worstTradeSymbol}
                </div>
                <div className="text-[11px] text-rose-300 font-semibold">
                  {(summary?.worstTradePercent ?? 0).toFixed(1)}% ({(summary?.worstTradeSol ?? 0).toFixed(3)} SOL)
                </div>
              </div>
            </div>
          </div>

          <div className="text-[11px] font-mono text-zinc-500 pt-3 border-t border-zinc-900">
            Protection Trailing Stop & Stop Loss appliquée sur chaque position
          </div>
        </div>

        {/* 7 GMGN Conditions Compliance Overview */}
        <div className="p-5 rounded-lg bg-zinc-950 border border-zinc-900 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wide">
                Filtre Strict des 7 Conditions
              </h3>
            </div>
            <p className="text-[11px] font-mono text-zinc-400">
              Audit on-chain multi-sources obligatoire avant tout snipe automatique
            </p>
          </div>

          <div className="space-y-2 text-xs font-mono my-auto py-2">
            {[
              { id: '1', name: 'Top 10 Holders < 30%', status: 'Strictement contrôlé' },
              { id: '2', name: 'MC <= Volume (Volume >= MC)', status: 'Strictement contrôlé' },
              { id: '3', name: 'Acheteurs >= Vendeurs', status: 'Strictement contrôlé' },
              { id: '4', name: 'Site Web & Réseaux Sociaux Propres', status: 'Strictement contrôlé' },
              { id: '5', name: 'Présence Sociale & No Honeypot', status: 'Strictement contrôlé' },
              { id: '6', name: 'KOLs / Alpha Wallets On-Chain', status: 'Strictement contrôlé' },
              { id: '7', name: 'Smart Money Wallets On-Chain', status: 'Strictement contrôlé' },
            ].map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between p-1.5 px-2.5 rounded bg-zinc-900/60 border border-zinc-850"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-[10px] text-zinc-500 font-bold">#{c.id}</span>
                  <span className="text-zinc-300 truncate text-[11px]">{c.name}</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-bold shrink-0">
                  ACTIF
                </span>
              </div>
            ))}
          </div>

          <div className="text-[11px] font-mono text-zinc-400 pt-3 border-t border-zinc-900 flex items-center justify-between">
            <span>Dernier rafraîchissement:</span>
            <span className="text-zinc-500">
              {new Date(lastRefreshed).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* Daily Breakdown Table */}
      <div className="p-5 rounded-lg bg-zinc-950 border border-zinc-900 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold font-mono text-white uppercase tracking-wide">
              Journal Quotidien des Performances ({timeframe} Derniers Jours)
            </h3>
          </div>
          <span className="text-xs font-mono text-zinc-500">
            {activeDaysCount} jours avec activité
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-zinc-900 text-zinc-500 text-[11px] uppercase tracking-wider">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Snipes Clôturés</th>
                <th className="py-2.5 px-3">Victoires / Pertes</th>
                <th className="py-2.5 px-3">Taux de Réussite</th>
                <th className="py-2.5 px-3 text-right">PnL SOL Journalier</th>
                <th className="py-2.5 px-3 text-right">PnL SOL Cumulé</th>
                <th className="py-2.5 px-3 text-center">Statut Jour</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/60">
              {days
                .slice()
                .reverse()
                .map((day) => {
                  const isProfitable = day.dailySolProfit > 0;
                  const isLoss = day.dailySolProfit < 0;

                  return (
                    <tr
                      key={day.date}
                      className="hover:bg-zinc-900/40 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-semibold text-white whitespace-nowrap">
                        {day.displayDate}{' '}
                        <span className="text-[10px] text-zinc-500 font-normal">
                          ({day.date})
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-zinc-300 whitespace-nowrap">
                        {day.tradesCount > 0 ? (
                          <span className="font-bold text-white">{day.tradesCount} trades</span>
                        ) : (
                          <span className="text-zinc-600">0 trade</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {day.tradesCount > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-emerald-400 font-bold">{day.wins}W</span>
                            <span className="text-zinc-600">/</span>
                            <span className="text-rose-400 font-bold">{day.losses}L</span>
                            {day.breakeven > 0 && (
                              <span className="text-zinc-500 text-[10px]">
                                ({day.breakeven} BE)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-600">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {day.tradesCount > 0 ? (
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              day.winRate >= 50
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-900/40'
                                : 'bg-rose-950 text-rose-300 border border-rose-900/40'
                            }`}
                          >
                            {day.winRate}%
                          </span>
                        ) : (
                          <span className="text-zinc-600">-</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span
                          className={`font-bold ${
                            isProfitable
                              ? 'text-emerald-400'
                              : isLoss
                              ? 'text-rose-400'
                              : 'text-zinc-500'
                          }`}
                        >
                          {day.dailySolProfit > 0 ? '+' : ''}
                          {day.dailySolProfit.toFixed(4)} SOL
                        </span>
                        {day.dailyUsdProfit !== 0 && (
                          <div className="text-[10px] text-zinc-500">
                            {day.dailyUsdProfit > 0 ? '+' : ''}${day.dailyUsdProfit.toFixed(2)}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span
                          className={`font-bold ${
                            day.cumulativeSolProfit >= 0 ? 'text-sky-400' : 'text-zinc-400'
                          }`}
                        >
                          {day.cumulativeSolProfit >= 0 ? '+' : ''}
                          {day.cumulativeSolProfit.toFixed(4)} SOL
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {day.tradesCount === 0 ? (
                          <span className="text-[10px] text-zinc-600 uppercase">Neutre</span>
                        ) : isProfitable ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 uppercase">
                            <TrendingUp className="w-3 h-3" /> Gain
                          </span>
                        ) : isLoss ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 uppercase">
                            <TrendingDown className="w-3 h-3" /> Perte
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 uppercase">Équilibré</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
