import React from 'react';
import { GMGNAnalysisReport, TelegramCall } from '../types';
import { ShieldCheck, ShieldAlert, AlertTriangle, Lock, Unlock, ExternalLink } from 'lucide-react';

interface AnalysisModalProps {
  call: TelegramCall | null;
  onClose: () => void;
  onManualSnipe: (tokenAddress: string) => void;
}

export const AnalysisModal: React.FC<AnalysisModalProps> = ({
  call,
  onClose,
  onManualSnipe,
}) => {
  if (!call || !call.analysis) return null;

  const r: GMGNAnalysisReport = call.analysis;
  const rc = r.rugCheck || call.rugCheck;
  const isSniped = r.decision === 'SNIPED';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4 text-xs font-mono shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white font-mono uppercase">
                ${r.tokenSymbol} Analysis
              </h3>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                  isSniped
                    ? 'bg-white text-black'
                    : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                {r.decision}
              </span>
            </div>
            <p className="text-zinc-500 text-[11px] mt-0.5 select-all">
              CA: {r.tokenAddress}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-900 border border-zinc-800"
          >
            ESC / CLOSE
          </button>
        </div>

        {/* Dedicated RugCheck Security Audit Card */}
        {rc && (
          <div className="p-3.5 rounded-lg border border-zinc-850 bg-black space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-900 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {rc.status === 'danger' || rc.rugged || rc.highRisksCount > 0 ? (
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                ) : rc.status === 'warn' || rc.warnRisksCount > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                )}
                <div>
                  <h4 className="text-xs font-bold text-white uppercase flex items-center gap-2">
                    <span>RugCheck On-Chain Security Audit</span>
                    <span
                      className={`px-2 py-0.2 rounded text-[10px] font-bold uppercase ${
                        rc.status === 'danger' || rc.rugged
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : rc.status === 'warn'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      }`}
                    >
                      Score: {rc.score} ({rc.statusLabel})
                    </span>
                  </h4>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Seuil de sécurité bot automatique : &lt; 800
                  </p>
                </div>
              </div>

              <a
                href={`https://rugcheck.xyz/tokens/${r.tokenAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-zinc-400 hover:text-white px-2 py-1 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 flex items-center gap-1"
              >
                <span>Rapport RugCheck.xyz</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Metrics & Authorities */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded bg-zinc-950 border border-zinc-900">
                <span className="text-[10px] text-zinc-500 block">SCORE RUGCHECK</span>
                <span className={`font-bold text-sm ${rc.score < 500 ? 'text-emerald-400' : rc.score < 1000 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {rc.score}
                </span>
              </div>

              <div className="p-2 rounded bg-zinc-950 border border-zinc-900">
                <span className="text-[10px] text-zinc-500 block">MINT AUTHORITY</span>
                <span className={`font-bold flex items-center gap-1 ${rc.mintAuthority === null ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {rc.mintAuthority === null ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {rc.mintAuthority === null ? 'Révoquée' : 'Active'}
                </span>
              </div>

              <div className="p-2 rounded bg-zinc-950 border border-zinc-900">
                <span className="text-[10px] text-zinc-500 block">FREEZE AUTHORITY</span>
                <span className={`font-bold flex items-center gap-1 ${rc.freezeAuthority === null ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {rc.freezeAuthority === null ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {rc.freezeAuthority === null ? 'Révoquée' : 'Active'}
                </span>
              </div>

              <div className="p-2 rounded bg-zinc-950 border border-zinc-900">
                <span className="text-[10px] text-zinc-500 block">LP VERROUILLÉE</span>
                <span className="font-bold text-white">
                  {rc.lpLockedPct !== undefined ? `${rc.lpLockedPct.toFixed(1)}%` : 'N/A'}
                </span>
              </div>
            </div>

            {/* Detected Risks breakdown */}
            {rc.risks && rc.risks.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-semibold text-zinc-400 block uppercase">
                  Facteurs de risque identifiés ({rc.risks.length}) :
                </span>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {rc.risks.map((risk, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded border text-[11px] flex items-start justify-between gap-2 ${
                        risk.level === 'danger'
                          ? 'bg-rose-950/30 border-rose-900/50 text-rose-300'
                          : risk.level === 'warn'
                          ? 'bg-amber-950/30 border-amber-900/50 text-amber-300'
                          : 'bg-zinc-900/50 border-zinc-800 text-zinc-300'
                      }`}
                    >
                      <div>
                        <div className="font-bold flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${risk.level === 'danger' ? 'bg-rose-500' : risk.level === 'warn' ? 'bg-amber-400' : 'bg-zinc-400'}`} />
                          <span>{risk.name}</span>
                          {risk.value && <span className="text-[10px] text-zinc-400 font-mono">({risk.value})</span>}
                        </div>
                        {risk.description && (
                          <p className="text-[10px] text-zinc-400 mt-0.5">{risk.description}</p>
                        )}
                      </div>
                      {risk.score > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/40 border border-current shrink-0">
                          +{risk.score}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-2 rounded bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 text-[11px] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>Aucun risque critique ou suspect détecté par RugCheck.xyz.</span>
              </div>
            )}
          </div>
        )}

        {/* 7 Conditions Checklist Detailed */}
        <div>
          <h4 className="text-zinc-400 font-semibold mb-2 uppercase text-[11px]">
            Sniper Rule Evaluation (7 Mandatory Conditions)
          </h4>
          <div className="space-y-2">
            {r.conditions.map((c, index) => (
              <div
                key={c.id}
                className={`p-3 rounded border flex flex-col gap-1 ${
                  c.passed
                    ? 'bg-zinc-900/40 border-white/20 text-zinc-300'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">
                    {index + 1}. {c.name}
                  </span>
                  <span
                    className={`px-1.5 py-0.2 text-[10px] font-bold rounded ${
                      c.passed ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-500'
                    }`}
                  >
                    {c.passed ? 'PASS' : 'REJECT'}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400">
                  <strong>Rule:</strong> {c.rule}
                </div>
                <div className="text-[11px] text-zinc-300">
                  <strong>Measured:</strong> {c.details}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Metrics Grid */}
        <div>
          <h4 className="text-zinc-400 font-semibold mb-2 uppercase text-[11px]">
            On-Chain Fundamentals & Market Intelligence
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="p-2.5 rounded bg-black border border-zinc-900">
              <span className="text-[10px] text-zinc-500 block">TOP 10 HOLDERS</span>
              <span className="text-white font-bold">{r.top10HoldersPercent.toFixed(1)}%</span>
            </div>
            <div className="p-2.5 rounded bg-black border border-zinc-900">
              <span className="text-[10px] text-zinc-500 block">MARKET CAP</span>
              <span className="text-white font-bold">${formatNum(r.marketCapUsd)}</span>
            </div>
            <div className="p-2.5 rounded bg-black border border-zinc-900">
              <span className="text-[10px] text-zinc-500 block">24H VOLUME</span>
              <span className="text-white font-bold">${formatNum(r.volume24hUsd)}</span>
            </div>
            <div className="p-2.5 rounded bg-black border border-zinc-900">
              <span className="text-[10px] text-zinc-500 block">BUYERS / SELLERS</span>
              <span className="text-white font-bold">{r.buyersCount} / {r.sellersCount}</span>
            </div>
            <div className="p-2.5 rounded bg-black border border-zinc-900">
              <span className="text-[10px] text-zinc-500 block">KOL WALLETS</span>
              <span className="text-white font-bold">{r.kolCount} detected</span>
            </div>
            <div className="p-2.5 rounded bg-black border border-zinc-900">
              <span className="text-[10px] text-zinc-500 block">SMART MONEY</span>
              <span className="text-white font-bold">{r.smartWalletCount} wallets</span>
            </div>
          </div>
        </div>

        {/* Links & Socials */}
        <div className="p-3 rounded bg-black border border-zinc-900 space-y-1.5 text-[11px]">
          <span className="text-zinc-500 block uppercase font-semibold">Social & Verification Links:</span>
          <div className="flex flex-wrap gap-3">
            {r.websiteUrl ? (
              <a href={r.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline">
                Website ↗
              </a>
            ) : (
              <span className="text-zinc-600">No Website</span>
            )}
            {r.twitterUrl ? (
              <a href={r.twitterUrl.startsWith('http') ? r.twitterUrl : `https://x.com/${r.twitterUrl}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline">
                Twitter/X ↗
              </a>
            ) : (
              <span className="text-zinc-600">No Twitter</span>
            )}
            {r.telegramUrl ? (
              <a href={r.telegramUrl.startsWith('http') ? r.telegramUrl : `https://t.me/${r.telegramUrl}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline">
                Telegram ↗
              </a>
            ) : (
              <span className="text-zinc-600">No Telegram</span>
            )}
            <a href={`https://dexscreener.com/solana/${r.tokenAddress}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white underline">
              Dexscreener ↗
            </a>
            <a href={`https://gmgn.ai/sol/token/${r.tokenAddress}`} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-white underline">
              GMGN.ai ↗
            </a>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800"
          >
            Close
          </button>

          <button
            onClick={() => {
              onManualSnipe(r.tokenAddress);
              onClose();
            }}
            className="px-5 py-2 rounded bg-white text-black font-semibold hover:bg-zinc-200"
          >
            Snipe This Token Now
          </button>
        </div>
      </div>
    </div>
  );
};

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(2);
}
