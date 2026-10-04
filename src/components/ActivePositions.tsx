import React, { useState, useEffect } from 'react';
import { authFetch } from '../api';
import {
  RefreshCw,
  ExternalLink,
  Activity,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Clock,
  ShieldAlert,
  Flame,
  CheckCircle2,
} from 'lucide-react';
import { ActivePosition } from '../types';

interface ActivePositionsProps {
  positions: ActivePosition[];
  onSellPosition: (positionId: string, percent: number) => void;
  onUpdateTargets?: (
    positionId: string,
    targets: {
      tpPercent?: number;
      slPercent?: number;
      trailingStopPercent?: number;
      autoSellStagnant?: boolean;
      stagnantTimeoutSeconds?: number;
    }
  ) => Promise<void>;
  onForceRefresh?: () => Promise<void>;
}

export const ActivePositions: React.FC<ActivePositionsProps> = ({
  positions,
  onSellPosition,
  onUpdateTargets,
  onForceRefresh,
}) => {
  const [sellingState, setSellingState] = useState<{ id: string; percent: number } | null>(null);
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [editTp, setEditTp] = useState<string>('');
  const [editSl, setEditSl] = useState<string>('');
  const [editTrailing, setEditTrailing] = useState<string>('');
  const [editAutoSellStagnant, setEditAutoSellStagnant] = useState<boolean>(true);
  const [editStagnantTimeout, setEditStagnantTimeout] = useState<string>('180');
  const [isSavingTargets, setIsSavingTargets] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(Date.now());
  const [secondsAgo, setSecondsAgo] = useState<number>(0);

  // Dynamic seconds ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo(Math.max(0, Math.floor((Date.now() - lastRefreshedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastRefreshedAt]);

  // Update last refreshed when positions change
  useEffect(() => {
    if (positions.length > 0) {
      const mostRecent = Math.max(...positions.map((p) => p.lastUpdated || p.openedAt || 0));
      if (mostRecent > 0) {
        setLastRefreshedAt(mostRecent);
        setSecondsAgo(0);
      }
    }
  }, [positions]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (onForceRefresh) {
        await onForceRefresh();
      } else {
        await authFetch('/api/positions/refresh', { method: 'POST' });
      }
      setLastRefreshedAt(Date.now());
      setSecondsAgo(0);
    } catch (err) {
      console.error('Failed to manually refresh prices:', err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const handleSellClick = async (positionId: string, percent: number) => {
    setSellingState({ id: positionId, percent });
    try {
      await onSellPosition(positionId, percent);
    } finally {
      setSellingState(null);
    }
  };

  const startEditing = (pos: ActivePosition) => {
    setEditingPosId(pos.id);
    setEditTp(pos.tpPercent.toString());
    setEditSl(pos.slPercent.toString());
    setEditTrailing(pos.trailingStopPercent.toString());
    setEditAutoSellStagnant(pos.autoSellStagnant !== false);
    setEditStagnantTimeout((pos.stagnantTimeoutSeconds || 180).toString());
  };

  const cancelEditing = () => {
    setEditingPosId(null);
  };

  const saveEditedTargets = async (positionId: string) => {
    if (!onUpdateTargets) return;
    setIsSavingTargets(true);
    try {
      await onUpdateTargets(positionId, {
        tpPercent: parseFloat(editTp) || 0,
        slPercent: parseFloat(editSl) || 0,
        trailingStopPercent: parseFloat(editTrailing) || 0,
        autoSellStagnant: editAutoSellStagnant,
        stagnantTimeoutSeconds: parseInt(editStagnantTimeout, 10) || 180,
      });
      setEditingPosId(null);
    } finally {
      setIsSavingTargets(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Live Tracker Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 rounded bg-zinc-950/80 border border-zinc-900">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping absolute opacity-75" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 relative" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white tracking-wide font-mono uppercase">
                Positions Ouvertes ({positions.length})
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-900/50 uppercase font-semibold">
                Tracker En Direct (2.5s)
              </span>
            </div>
            <div className="text-[11px] font-mono text-zinc-400 mt-0.5 flex items-center gap-2">
              <span>Flux on-chain : DexScreener & RPC Solana</span>
              <span>•</span>
              <span>Dernier ping : il y a {secondsAgo}s</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-200 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{isRefreshing ? 'Actualisation...' : 'Rafraîchir les cours'}</span>
          </button>
        </div>
      </div>

      {positions.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-zinc-900 rounded bg-zinc-950/40">
          <p className="text-xs font-mono text-zinc-400 mb-1">
            Aucune position ouverte actuellement.
          </p>
          <p className="text-[11px] text-zinc-500">
            Dès qu'un token Telegram valide les 7 conditions strictes GMGN, le bot l'achète automatiquement et active son suivi de prix seconde par seconde.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {positions.map((pos, idx) => {
            const isProfit = pos.pnlPercent >= 0.001;
            const isLoss = pos.pnlPercent <= -0.001;
            const hasTp = pos.tpPercent > 0;
            const hasSl = pos.slPercent > 0;
            const hasTrailing = pos.trailingStopPercent > 0;
            const progressToTp = hasTp
              ? Math.min(100, Math.max(0, (pos.pnlPercent / pos.tpPercent) * 100))
              : 0;
            const isEditing = editingPosId === pos.id;

            const total5mTxns = (pos.buys5m || 0) + (pos.sells5m || 0);
            const isLowActivity = total5mTxns <= 1;

            const dexUrl =
              pos.dexUrl || `https://dexscreener.com/solana/${pos.tokenAddress}`;

            const secondsSinceOpen = Math.max(0, Math.floor((Date.now() - pos.openedAt) / 1000));
            const openDurationFormatted =
              secondsSinceOpen < 60
                ? `${secondsSinceOpen}s`
                : `${Math.floor(secondsSinceOpen / 60)}m ${secondsSinceOpen % 60}s`;

            return (
              <div
                key={`${pos.id}_${idx}`}
                className="p-4 rounded-lg border border-zinc-800 bg-zinc-950 shadow-md transition-all space-y-3"
              >
                {/* Top Row: Symbol, Badges, PnL Readout */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold font-mono text-white">
                        ${pos.tokenSymbol}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800 uppercase font-semibold">
                        {pos.router}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-850">
                        {pos.executionMode === 'simulation' ? 'SIMULATION' : 'RÉEL'}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {openDurationFormatted}
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-zinc-400 mt-1 flex items-center gap-2 flex-wrap">
                      <span>Mise : <strong className="text-zinc-200">{pos.amountSol} SOL</strong></span>
                      <span>•</span>
                      <span>Jetons : <strong className="text-zinc-200">{Number(pos.amountTokens).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</strong></span>
                      <span>•</span>
                      <span className="text-zinc-500 truncate max-w-[140px] sm:max-w-[200px]" title={pos.tokenAddress}>
                        CA: {pos.tokenAddress.slice(0, 6)}...{pos.tokenAddress.slice(-4)}
                      </span>
                    </div>
                  </div>

                  {/* Real-time PnL Display */}
                  <div className="text-right shrink-0">
                    <div
                      className={`text-xl font-mono font-bold tracking-tight ${
                        isProfit ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-zinc-400'
                      }`}
                    >
                      {pos.pnlPercent > 0 ? '+' : ''}
                      {pos.pnlPercent.toFixed(2)}%
                    </div>
                    {(() => {
                      const solVal =
                        pos.pnlSol !== undefined
                          ? pos.pnlSol
                          : (pos.amountSol * pos.pnlPercent) / 100;
                      const usdVal =
                        pos.pnlUsd !== undefined && Math.abs(pos.pnlUsd) > 0.001
                          ? pos.pnlUsd
                          : solVal * 117.14;
                      return (
                        <div className="text-xs font-mono text-zinc-300 mt-0.5">
                          <span className={usdVal >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                            {usdVal >= 0 ? '+' : ''}${usdVal.toFixed(2)}
                          </span>
                          <span className="text-zinc-400 text-[11px] ml-1">
                            ({solVal >= 0 ? '+' : ''}{solVal.toFixed(4)} SOL)
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Price Matrix with High-Precision Micro-cap Formatter */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded bg-black/90 border border-zinc-900 text-xs font-mono">
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">PRIX D'ENTRÉE</div>
                    <div className="text-zinc-300 font-semibold truncate text-[13px] mt-0.5">
                      ${formatPrice(pos.entryPriceUsd)}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                      <span>PRIX EN DIRECT</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    </div>
                    <div
                      className={`font-bold truncate text-[13px] mt-0.5 ${
                        isProfit ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-white'
                      }`}
                    >
                      ${formatPrice(pos.currentPriceUsd)}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">PIC ATTEINT (HIGH)</div>
                    <div className="text-amber-300 font-semibold truncate text-[13px] mt-0.5">
                      ${formatPrice(pos.peakPriceUsd)}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">TRAILING STOP</div>
                    <div className="text-zinc-400 font-semibold truncate text-[13px] mt-0.5">
                      {hasTrailing && pos.trailingStopPriceUsd > 0
                        ? `$${formatPrice(pos.trailingStopPriceUsd)}`
                        : 'DÉSACTIVÉ (0%)'}
                    </div>
                  </div>
                </div>

                {/* Market Activity & Liquidity Notice */}
                <div className="p-2.5 rounded bg-zinc-900/50 border border-zinc-850 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <div className="text-[11px] text-zinc-300">
                      <span>Activité on-chain (5 min) : </span>
                      <span className="text-emerald-400 font-bold">{pos.buys5m || 0} achats</span>
                      <span> / </span>
                      <span className="text-rose-400 font-bold">{pos.sells5m || 0} ventes</span>
                      {Boolean(pos.volume5mUsd) && (
                        <span className="text-zinc-400"> (Vol. ${pos.volume5mUsd?.toFixed(1)})</span>
                      )}
                    </div>
                  </div>

                  {/* Direct Link to Dexscreener Chart */}
                  <a
                    href={dexUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-850 hover:bg-zinc-800 text-sky-300 hover:text-sky-200 text-[11px] transition-colors border border-zinc-700/60 w-fit shrink-0 cursor-pointer"
                  >
                    <span>Voir sur DexScreener</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Quiet Market Warning if no txns in last 5m */}
                {isLowActivity && (
                  <div className="p-2 rounded bg-amber-950/20 border border-amber-900/30 flex items-start gap-2 text-[11px] font-mono text-amber-300/90">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Activité on-chain calme :</strong> Aucun échange récent sur ce jeton dans le pool Solana. Sur une bonding curve ou un pool AMM, le cours reste statique tant qu'aucun nouvel ordre d'achat ou de vente n'est validé par la blockchain.
                    </span>
                  </div>
                )}

                {/* Auto-Sell Stagnation (Inactivité / Cours Immobile) Banner */}
                {pos.autoSellStagnant !== false && (
                  <div
                    className={`p-2.5 rounded border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono transition-colors ${
                      (Date.now() - (pos.lastPriceMovementAt || pos.openedAt)) / 1000 >= (pos.stagnantTimeoutSeconds || 180)
                        ? 'bg-rose-950/40 border-rose-900/60 text-rose-300'
                        : 'bg-zinc-900/70 border-zinc-800 text-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Clock
                        className={`w-4 h-4 shrink-0 ${
                          (Date.now() - (pos.lastPriceMovementAt || pos.openedAt)) / 1000 >= (pos.stagnantTimeoutSeconds || 180)
                            ? 'text-rose-400 animate-pulse'
                            : 'text-amber-400'
                        }`}
                      />
                      <div>
                        <span className="font-semibold text-white">
                          Auto-Sell Stagnation ({Math.round((pos.stagnantTimeoutSeconds || 180) / 60)} min) :{' '}
                        </span>
                        {(Date.now() - (pos.lastPriceMovementAt || pos.openedAt)) / 1000 >= (pos.stagnantTimeoutSeconds || 180) ? (
                          <span className="text-rose-300 font-bold animate-pulse">
                            Cours immobile depuis &gt; {Math.floor(((Date.now() - (pos.lastPriceMovementAt || pos.openedAt)) / 1000) / 60)} min — Vente 100% imminente...
                          </span>
                        ) : (
                          <span className="text-amber-300">
                            Vente 100% dans{' '}
                            {Math.max(
                              0,
                              Math.floor(
                                ((pos.stagnantTimeoutSeconds || 180) -
                                  (Date.now() - (pos.lastPriceMovementAt || pos.openedAt)) / 1000) /
                                  60
                              )
                            )}m{' '}
                            {Math.max(
                              0,
                              Math.floor(
                                ((pos.stagnantTimeoutSeconds || 180) -
                                  (Date.now() - (pos.lastPriceMovementAt || pos.openedAt)) / 1000) %
                                  60
                              )
                            )}s si aucun mouvement de prix
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="text-[10px] text-zinc-400 shrink-0">
                      Seuil: ±{pos.stagnantThresholdPercent || 1}%
                    </span>
                  </div>
                )}

                {/* Targets Indicators (TP, SL, Trailing) */}
                <div className="space-y-1.5 pt-1 text-xs font-mono">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 flex-wrap gap-1">
                    <span>
                      Stop Loss :{' '}
                      {hasSl ? (
                        <strong className="text-rose-400">
                          -{pos.slPercent}% (${formatPrice(pos.slPriceUsd)})
                        </strong>
                      ) : (
                        <span className="text-zinc-500">Désactivé (0%)</span>
                      )}
                    </span>
                    <span>
                      Take Profit :{' '}
                      {hasTp ? (
                        <strong className="text-emerald-400">
                          +{pos.tpPercent}% (${formatPrice(pos.tpPriceUsd)})
                        </strong>
                      ) : (
                        <span className="text-zinc-500">Désactivé (0%)</span>
                      )}
                    </span>
                  </div>

                  {/* Progress bar towards TP */}
                  {hasTp && (
                    <div className="h-1.5 w-full bg-zinc-900 rounded overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${progressToTp}%` }}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span>
                      Trailing Stop :{' '}
                      {hasTrailing ? (
                        <span className="text-amber-400">
                          -{pos.trailingStopPercent}% depuis le pic
                        </span>
                      ) : (
                        <span className="text-zinc-600">Désactivé (0%)</span>
                      )}
                    </span>
                    <span>
                      Statut vérifié en continu
                    </span>
                  </div>
                </div>

                {/* Inline Targets Editor */}
                {isEditing && (
                  <div className="my-2 p-3 rounded border border-zinc-800 bg-black text-xs font-mono space-y-3">
                    <div className="flex items-center justify-between border-b border-zinc-900 pb-1.5">
                      <span className="font-semibold text-white">
                        AJUSTER LES LIMITES DE CETTE POSITION
                      </span>
                      <span className="text-[10px] text-zinc-500">0% = Désactiver</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {/* Edit TP */}
                      <div>
                        <div className="text-[10px] text-zinc-400 mb-1">Take Profit % (0 = Off)</div>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={editTp}
                          onChange={(e) => setEditTp(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-white text-xs"
                        />
                        <div className="flex gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => setEditTp('0')}
                            className="px-1 text-[10px] bg-zinc-900 text-zinc-400 rounded hover:text-white"
                          >
                            0%
                          </button>
                          {[25, 50, 100].map((v) => (
                            <button
                              type="button"
                              key={v}
                              onClick={() => setEditTp(v.toString())}
                              className="px-1 text-[10px] bg-zinc-900 text-zinc-400 rounded hover:text-white"
                            >
                              +{v}%
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Edit SL */}
                      <div>
                        <div className="text-[10px] text-zinc-400 mb-1">Stop Loss % (0 = Off)</div>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="99"
                          value={editSl}
                          onChange={(e) => setEditSl(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-white text-xs"
                        />
                        <div className="flex gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => setEditSl('0')}
                            className="px-1 text-[10px] bg-zinc-900 text-zinc-400 rounded hover:text-white"
                          >
                            0%
                          </button>
                          {[10, 15, 25].map((v) => (
                            <button
                              type="button"
                              key={v}
                              onClick={() => setEditSl(v.toString())}
                              className="px-1 text-[10px] bg-zinc-900 text-zinc-400 rounded hover:text-white"
                            >
                              -{v}%
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Edit Trailing Stop */}
                      <div>
                        <div className="text-[10px] text-zinc-400 mb-1">Trailing Stop % (0 = Off)</div>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="90"
                          value={editTrailing}
                          onChange={(e) => setEditTrailing(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-white text-xs"
                        />
                        <div className="flex gap-1 mt-1">
                          <button
                            type="button"
                            onClick={() => setEditTrailing('0')}
                            className="px-1 text-[10px] bg-amber-950/80 text-amber-300 rounded hover:text-white"
                          >
                            0% (Off)
                          </button>
                          {[5, 10, 15].map((v) => (
                            <button
                              type="button"
                              key={v}
                              onClick={() => setEditTrailing(v.toString())}
                              className="px-1 text-[10px] bg-zinc-900 text-zinc-400 rounded hover:text-white"
                            >
                              {v}%
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Stagnation Auto-Sell Controls */}
                    <div className="p-2.5 rounded bg-zinc-950 border border-zinc-850 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-300 font-semibold">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>AUTO-SELL SI LE COURS NE BOUGE PAS (STAGNATION)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditAutoSellStagnant(!editAutoSellStagnant)}
                          className={`px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer transition-colors ${
                            editAutoSellStagnant
                              ? 'bg-amber-500 text-black'
                              : 'bg-zinc-850 text-zinc-400 hover:text-white'
                          }`}
                        >
                          {editAutoSellStagnant ? 'ACTIVÉ' : 'DÉSACTIVÉ'}
                        </button>
                      </div>

                      {editAutoSellStagnant && (
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-900 flex-wrap">
                          <span className="text-[10px] text-zinc-400">Délai sans mouvement :</span>
                          <div className="flex gap-1">
                            {[
                              { label: '1 min', sec: 60 },
                              { label: '2 min', sec: 120 },
                              { label: '3 min', sec: 180 },
                              { label: '5 min', sec: 300 },
                            ].map((item) => (
                              <button
                                key={item.sec}
                                type="button"
                                onClick={() => setEditStagnantTimeout(item.sec.toString())}
                                className={`px-2 py-0.5 text-[10px] rounded border cursor-pointer transition-colors ${
                                  editStagnantTimeout === item.sec.toString()
                                    ? 'bg-amber-400 text-black border-amber-300 font-bold'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white'
                                }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-zinc-900">
                      <button
                        type="button"
                        onClick={cancelEditing}
                        disabled={isSavingTargets}
                        className="px-2.5 py-1 rounded bg-zinc-900 text-zinc-400 hover:text-white text-xs cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEditedTargets(pos.id)}
                        disabled={isSavingTargets}
                        className="px-3 py-1 rounded bg-white text-black font-semibold text-xs hover:bg-zinc-200 cursor-pointer"
                      >
                        {isSavingTargets ? 'Enregistrement...' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Quick Exit & Adjust Actions */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-900">
                  <div>
                    {!isEditing && onUpdateTargets && (
                      <button
                        type="button"
                        onClick={() => startEditing(pos)}
                        className="text-[11px] font-mono text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        ⚙ Modifier SL/TP/TS
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      id={`btn-sell-50-${pos.id}`}
                      disabled={sellingState?.id === pos.id}
                      onClick={() => handleSellClick(pos.id, 50)}
                      className="px-3 py-1.5 text-xs font-mono rounded bg-zinc-900 text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-opacity cursor-pointer"
                    >
                      {sellingState?.id === pos.id && sellingState?.percent === 50 ? (
                        <>
                          <span className="w-2.5 h-2.5 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                          VENTE 50%...
                        </>
                      ) : (
                        'VENDRE 50%'
                      )}
                    </button>
                    <button
                      id={`btn-sell-100-${pos.id}`}
                      disabled={sellingState?.id === pos.id}
                      onClick={() => handleSellClick(pos.id, 100)}
                      className="px-3.5 py-1.5 text-xs font-mono font-semibold rounded bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-opacity cursor-pointer"
                    >
                      {sellingState?.id === pos.id && sellingState?.percent === 100 ? (
                        <>
                          <span className="w-2.5 h-2.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                          VENTE 100%...
                        </>
                      ) : (
                        'VENDRE 100%'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/**
 * Format token prices clearly for micro-caps without ugly exponential/scientific notation
 */
export function formatPrice(p: number): string {
  if (!p || p === 0 || isNaN(p)) return '0.00';
  if (p >= 1) {
    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (p >= 0.01) {
    return p.toFixed(4);
  }
  if (p >= 0.0001) {
    return p.toFixed(6);
  }
  // For micro-caps (e.g. 0.000003324), output cleanly formatted 8-9 decimal places
  // e.g. 0.000003324 instead of 3.3240e-6
  const str = p.toFixed(9);
  // Remove unnecessary trailing zeroes if they exceed 6 decimal places, but keep at least 6
  return str.replace(/(\.\d{6,}?)0+$/, '$1');
}
