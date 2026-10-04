import React from 'react';
import { Wallet, Smartphone, ShieldCheck, Lock, AlertTriangle } from 'lucide-react';
import { SecurityStatus, SniperConfig, TelegramStatus } from '../types';

interface HeaderProps {
  status: TelegramStatus | null;
  config: SniperConfig;
  onToggleAutoSnipe: () => void;
  activePositionsCount: number;
  totalCallsCount: number;
  totalPnlUsd: number;
  onOpenSettings?: () => void;
  securityStatus?: SecurityStatus | null;
  onLockDashboard?: () => void;
  onOpenSecurityModal?: () => void;
  riskStatus?: { circuitBreakerTripped: boolean; circuitBreakerReason?: string; liveTradingEnabled: boolean } | null;
  onResetCircuitBreaker?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  config,
  onToggleAutoSnipe,
  activePositionsCount,
  totalCallsCount,
  totalPnlUsd,
  onOpenSettings,
  securityStatus,
  onLockDashboard,
  onOpenSecurityModal,
  riskStatus,
  onResetCircuitBreaker,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-black sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Left: Branding & Channel Status */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg font-bold tracking-wider text-white font-mono uppercase">
              SolSnipe
            </h1>
            <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase">
              v2.5
            </span>
            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider uppercase bg-emerald-950 text-emerald-300 border border-emerald-800/50">
              SIMULATION MODE
            </span>
          </div>

          <div className="h-4 w-[1px] bg-zinc-800 hidden sm:block" />

          {/* Telegram Channels Live Status */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {(() => {
              const channelList = status?.channels && status.channels.length > 0
                ? status.channels
                : ['t.me/pumpdotfunalert'];
              const visible = channelList.slice(0, 3);
              const extraCount = channelList.length - visible.length;

              return (
                <>
                  {visible.map((ch) => {
                    const clean = ch.replace('https://t.me/', '').replace('t.me/', '').replace('@', '');
                    return (
                      <div
                        key={ch}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-950 border border-zinc-850 text-xs font-mono"
                      >
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            status?.connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'
                          }`}
                        />
                        <a
                          href={`https://t.me/${clean}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-300 hover:text-white hover:underline truncate max-w-[140px] text-[11px]"
                        >
                          t.me/{clean}
                        </a>
                      </div>
                    );
                  })}
                  {extraCount > 0 && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors cursor-pointer"
                      title="Voir tous les canaux dans les paramètres"
                    >
                      +{extraCount} autre{extraCount > 1 ? 's' : ''}
                    </button>
                  )}
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono text-emerald-400/90 hover:text-emerald-300 border border-emerald-900/40 hover:bg-emerald-950/30 transition-colors cursor-pointer ml-0.5"
                      title="Gérer les canaux Telegram"
                    >
                      + / - Canaux
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Middle / Right: Wallet pill & Telegram pill & Controls */}
        <div className="flex items-center gap-2.5 sm:gap-4 flex-wrap">
          {/* Quick Wallet Pill */}
          <button
            type="button"
            onClick={onOpenSettings}
            title="Cliquez pour gérer votre portefeuille Solana et clé privée"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-xs font-mono transition-colors cursor-pointer"
          >
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-zinc-400 text-[11px]">SOL:</span>
            <span className="text-white font-bold text-xs">
              {(config.walletBalanceSol ?? 0).toFixed(3)}
            </span>
            <span
              className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                config.executionMode === 'wallet'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/40'
                  : 'bg-zinc-850 text-zinc-400 border border-zinc-750'
              }`}
            >
              {config.executionMode === 'wallet' ? 'RÉEL' : 'SIMU'}
            </span>
          </button>

          {/* Quick Telegram Pill */}
          <button
            type="button"
            onClick={onOpenSettings}
            title={status?.connected ? 'Écoute Telegram active en temps réel' : 'Cliquez pour configurer le numéro et code Telegram'}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-xs font-mono transition-colors cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-zinc-400 text-[11px]">TG:</span>
            <span
              className={`text-[11px] font-bold truncate max-w-[110px] ${
                status?.connected ? 'text-emerald-300' : 'text-zinc-400'
              }`}
            >
              {status?.isAuthenticated ? `@${status.userName || 'Connecté'}` : status?.connected ? 'Flux Live' : (status?.phone || 'Hors ligne')}
            </span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status?.connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-500'
              }`}
            />
          </button>

          <div className="h-4 w-[1px] bg-zinc-800 hidden sm:block" />

          {/* Metrics */}
          <div className="flex items-center gap-3 text-xs font-mono">
            <div>
              <span className="text-zinc-500 text-[10px] mr-1">PNL:</span>
              <span
                className={`font-semibold text-xs ${
                  totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-zinc-400'
                }`}
              >
                {totalPnlUsd >= 0 ? '+' : ''}${totalPnlUsd.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Circuit Breaker Alert */}
          {riskStatus?.circuitBreakerTripped && (
            <button
              type="button"
              onClick={onResetCircuitBreaker}
              title={`Circuit Breaker actif : ${riskStatus.circuitBreakerReason || 'Protection active'}. Cliquez pour réinitialiser.`}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-950/90 hover:bg-rose-900 border border-rose-500 text-rose-200 text-xs font-mono font-bold animate-pulse transition-colors cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
              <span>CIRCUIT BREAKER</span>
            </button>
          )}

          {/* Auto-Snipe Switch Button */}
          <button
            onClick={onToggleAutoSnipe}
            className={`px-3 py-1 text-xs font-mono font-bold tracking-wider rounded uppercase transition-colors border cursor-pointer ${
              config.autoSnipe
                ? 'bg-white text-black border-white hover:bg-zinc-200'
                : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:text-white'
            }`}
          >
            {config.autoSnipe ? '● AUTO ON' : '○ AUTO OFF'}
          </button>

          {/* Lock / Security Button */}
          {securityStatus?.enabled ? (
            <button
              type="button"
              onClick={onLockDashboard}
              title="Verrouiller le dashboard maintenant"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline text-[11px] font-bold">Verrouiller</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenSecurityModal}
              title="Configurer un code d'accès au dashboard"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-xs font-mono text-amber-400/90 hover:text-amber-300 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline text-[11px] font-bold">Code Dashboard</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
