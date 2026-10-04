import React, { useState } from 'react';
import { RugCheckSummary } from '../types';
import { ShieldCheck, ShieldAlert, AlertTriangle, Shield, ExternalLink, ChevronDown, ChevronUp, Lock, Unlock } from 'lucide-react';

interface RugCheckBadgeProps {
  tokenAddress: string;
  rugCheck?: RugCheckSummary | null;
  compact?: boolean;
  showDetailsButton?: boolean;
}

export const RugCheckBadge: React.FC<RugCheckBadgeProps> = ({
  tokenAddress,
  rugCheck,
  compact = false,
  showDetailsButton = true,
}) => {
  const [showPopover, setShowPopover] = useState(false);

  // If no RugCheck data available yet
  if (!rugCheck) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-900/90 text-zinc-400 border border-zinc-800"
        title="Audit RugCheck en attente ou en cours..."
      >
        <Shield className="w-3 h-3 text-zinc-500 animate-pulse" />
        <span>RugCheck: En attente</span>
      </div>
    );
  }

  const { score, status, statusLabel, rugged, risks = [], highRisksCount = 0, warnRisksCount = 0, lpLockedPct, mintAuthority, freezeAuthority } = rugCheck;

  // Status configuration
  let colorClasses = {
    badge: 'bg-emerald-950/70 text-emerald-400 border-emerald-800/80 hover:border-emerald-600',
    dot: 'bg-emerald-400',
    title: 'text-emerald-400',
    icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />,
    label: 'BON / SÉCURISÉ',
  };

  if (rugged || status === 'danger' || highRisksCount > 0 || score >= 1000) {
    colorClasses = {
      badge: 'bg-rose-950/80 text-rose-300 border-rose-800/90 hover:border-rose-600 animate-pulse',
      dot: 'bg-rose-500',
      title: 'text-rose-400',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />,
      label: rugged ? 'RUGGED' : 'DANGER',
    };
  } else if (status === 'warn' || warnRisksCount > 0 || score >= 500) {
    colorClasses = {
      badge: 'bg-amber-950/70 text-amber-300 border-amber-800/80 hover:border-amber-600',
      dot: 'bg-amber-400',
      title: 'text-amber-400',
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />,
      label: 'ATTENTION',
    };
  }

  const rugCheckUrl = `https://rugcheck.xyz/tokens/${tokenAddress}`;

  return (
    <div className="relative inline-block font-mono">
      {/* Interactive Badge Button */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowPopover(!showPopover);
          }}
          className={`group inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border transition-all cursor-pointer shadow-sm ${colorClasses.badge}`}
          title={`Score RugCheck: ${score} - Cliquez pour voir les risques détectés`}
        >
          {colorClasses.icon}
          <span className="font-bold tracking-wider">
            RugCheck: <span className="underline decoration-dotted underline-offset-2">{score}</span>
          </span>
          <span className="text-[10px] uppercase font-bold opacity-90">
            ({colorClasses.label})
          </span>

          {highRisksCount > 0 && (
            <span className="px-1 py-0.2 rounded text-[9px] bg-rose-600 text-white font-bold">
              {highRisksCount} danger
            </span>
          )}

          {showDetailsButton && (
            <span className="text-zinc-400 group-hover:text-white ml-0.5 transition-transform">
              {showPopover ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </span>
          )}
        </button>

        {/* Quick Link to official RugCheck */}
        <a
          href={rugCheckUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-[10px] text-zinc-500 hover:text-white p-1 rounded hover:bg-zinc-900 border border-transparent hover:border-zinc-800 transition-colors flex items-center"
          title="Consulter le rapport officiel sur RugCheck.xyz"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Popover / Details dropdown */}
      {showPopover && (
        <>
          {/* Backdrop click-away */}
          <div
            className="fixed inset-0 z-30"
            onClick={(e) => {
              e.stopPropagation();
              setShowPopover(false);
            }}
          />

          <div
            className="absolute left-0 top-full mt-2 z-40 w-72 sm:w-80 p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 shadow-2xl space-y-2.5 text-xs text-zinc-300 animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popover Header */}
            <div className="flex items-start justify-between border-b border-zinc-900 pb-2">
              <div>
                <div className="flex items-center gap-1.5 font-bold">
                  {colorClasses.icon}
                  <span className={`text-xs uppercase font-mono ${colorClasses.title}`}>
                    RugCheck Security Audit
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Score de risque : <strong className="text-white">{score}</strong> ({statusLabel})
                </p>
              </div>

              <a
                href={rugCheckUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-white hover:text-black hover:bg-white px-2 py-0.5 rounded border border-zinc-700 transition-colors flex items-center gap-1"
              >
                RugCheck ↗
              </a>
            </div>

            {/* Quick Metrics (Authorities, LP Lock) */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono py-1">
              <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex items-center justify-between">
                <span className="text-zinc-400">Mint Authority:</span>
                <span className={mintAuthority === null ? 'text-emerald-400 font-bold flex items-center gap-0.5' : 'text-rose-400 font-bold flex items-center gap-0.5'}>
                  {mintAuthority === null ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {mintAuthority === null ? 'Révoquée' : 'Active'}
                </span>
              </div>

              <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex items-center justify-between">
                <span className="text-zinc-400">Freeze Auth:</span>
                <span className={freezeAuthority === null ? 'text-emerald-400 font-bold flex items-center gap-0.5' : 'text-rose-400 font-bold flex items-center gap-0.5'}>
                  {freezeAuthority === null ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {freezeAuthority === null ? 'Révoquée' : 'Active'}
                </span>
              </div>

              {lpLockedPct !== undefined && (
                <div className="p-1.5 rounded bg-zinc-900/80 border border-zinc-800/80 flex items-center justify-between col-span-2">
                  <span className="text-zinc-400">Liquidité (LP) bloquée :</span>
                  <span className={lpLockedPct >= 80 ? 'text-emerald-400 font-bold' : lpLockedPct >= 50 ? 'text-amber-300 font-bold' : 'text-rose-400 font-bold'}>
                    {lpLockedPct.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>

            {/* Risks List */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 mb-1.5">
                <span>Risques détectés ({risks.length})</span>
                <span className="text-[10px] text-zinc-500">
                  {highRisksCount} danger • {warnRisksCount} warn
                </span>
              </div>

              {risks.length === 0 ? (
                <div className="p-2 rounded bg-emerald-950/30 border border-emerald-900/40 text-[11px] text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Aucun risque détecté par l'audit RugCheck.xyz.</span>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {risks.map((risk, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded text-[11px] border leading-tight ${
                        risk.level === 'danger'
                          ? 'bg-rose-950/40 border-rose-900/60 text-rose-200'
                          : risk.level === 'warn'
                          ? 'bg-amber-950/40 border-amber-900/60 text-amber-200'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold mb-0.5">
                        <span className="flex items-center gap-1">
                          {risk.level === 'danger' ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                          ) : risk.level === 'warn' ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                          )}
                          {risk.name}
                        </span>
                        {risk.score > 0 && (
                          <span className="text-[9px] opacity-75 font-mono">
                            +{risk.score} pts
                          </span>
                        )}
                      </div>
                      {risk.description && (
                        <p className="text-[10px] opacity-85">{risk.description}</p>
                      )}
                      {risk.value && (
                        <p className="text-[10px] font-mono text-zinc-400 mt-0.5">Valeur : {risk.value}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer advice */}
            <div className="pt-2 border-t border-zinc-900 text-[10px] text-zinc-500 flex items-center justify-between">
              <span>Seuil de sécurité bot : &lt; 800</span>
              <button
                type="button"
                onClick={() => setShowPopover(false)}
                className="text-zinc-400 hover:text-white underline cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
