import React from 'react';
import { TradeHistoryItem } from '../types';

interface TradeHistoryProps {
  history: TradeHistoryItem[];
}

export const TradeHistory: React.FC<TradeHistoryProps> = ({ history }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-900">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white tracking-wide font-mono uppercase">
            Closed Trades & History
          </span>
          <span className="text-xs text-zinc-500 font-mono">
            ({history.length} trades)
          </span>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-zinc-900 rounded bg-zinc-950/40">
          <p className="text-xs font-mono text-zinc-500">
            No closed trades yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {history.map((trade, idx) => {
            const isProfit = trade.realizedPnlPercent >= 0;
            const durationSec = Math.round((trade.closedAt - trade.openedAt) / 1000);

            return (
              <div
                key={`${trade.id}_${idx}`}
                className="p-3.5 rounded border border-zinc-900 bg-zinc-950/70 flex items-center justify-between gap-4 text-xs font-mono"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">${trade.tokenSymbol}</span>
                    <span className="text-[10px] text-zinc-500 uppercase px-1.5 py-0.5 rounded bg-zinc-900">
                      {trade.router}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {trade.amountSol} SOL
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    Exit:{' '}
                    <span
                      className={`font-semibold ${
                        trade.exitReason?.includes('Stagnation')
                          ? 'text-amber-300'
                          : trade.exitReason?.includes('Take Profit')
                          ? 'text-emerald-400'
                          : trade.exitReason?.includes('Stop Loss')
                          ? 'text-rose-400'
                          : 'text-zinc-300'
                      }`}
                    >
                      {trade.exitReason}
                    </span>{' '}
                    ({durationSec}s)
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`font-bold text-sm ${
                      trade.realizedPnlPercent > 0.01
                        ? 'text-emerald-400'
                        : trade.realizedPnlPercent < -0.01
                        ? 'text-rose-400'
                        : 'text-zinc-400'
                    }`}
                  >
                    {trade.realizedPnlPercent > 0 ? '+' : ''}
                    {trade.realizedPnlPercent.toFixed(2)}%
                  </div>
                  {(() => {
                    const solPnl =
                      trade.realizedPnlSol !== undefined
                        ? trade.realizedPnlSol
                        : ((trade.amountSol || 0.1) * trade.realizedPnlPercent) / 100;
                    const usdPnl =
                      trade.realizedPnlUsd !== undefined && Math.abs(trade.realizedPnlUsd) > 0.001
                        ? trade.realizedPnlUsd
                        : solPnl * 117.14;
                    return (
                      <div className="text-[11px] font-mono text-zinc-400">
                        <span className={usdPnl >= 0 ? 'text-emerald-400/90' : 'text-rose-400/90'}>
                          {usdPnl >= 0 ? '+' : ''}${usdPnl.toFixed(2)}
                        </span>
                        <span className="text-zinc-500 text-[10px] ml-1">
                          ({solPnl >= 0 ? '+' : ''}{solPnl.toFixed(4)} SOL)
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
