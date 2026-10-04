import React, { useState } from 'react';

interface ManualAnalyzerProps {
  onAnalyze: (address: string) => Promise<void>;
  isAnalyzing: boolean;
}

export const ManualAnalyzer: React.FC<ManualAnalyzerProps> = ({
  onAnalyze,
  isAnalyzing,
}) => {
  const [address, setAddress] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;
    await onAnalyze(address.trim());
  };

  return (
    <div className="p-4 rounded border border-zinc-900 bg-zinc-950/70 text-xs font-mono">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white font-semibold uppercase">
          Manual Token CA Scanner
        </span>
        <span className="text-zinc-500 text-[11px]">GMGN Skill Pipeline</span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          placeholder="Paste Solana Mint Address (e.g. F46H2QLqv9...pump)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="flex-1 bg-black border border-zinc-800 rounded px-3 py-2 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white text-xs font-mono"
        />
        <button
          type="submit"
          disabled={isAnalyzing || !address.trim()}
          className="px-4 py-2 bg-white text-black font-semibold rounded hover:bg-zinc-200 transition-colors disabled:opacity-50 uppercase tracking-wider"
        >
          {isAnalyzing ? 'Auditing...' : 'Audit Token'}
        </button>
      </form>

      <div className="flex items-center gap-2 mt-2.5 text-[11px] text-zinc-500 flex-wrap">
        <span>Quick Test CAs:</span>
        <button
          type="button"
          onClick={() => setAddress('F46H2QLqv9JznhJsMS2PgUFosPUVRVWDtQf94ynGpump')}
          className="hover:text-white underline decoration-zinc-700"
        >
          $SPC (Recent Call)
        </button>
        <span>•</span>
        <button
          type="button"
          onClick={() => setAddress('EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm')}
          className="hover:text-white underline decoration-zinc-700"
        >
          $WIF
        </button>
        <span>•</span>
        <button
          type="button"
          onClick={() => setAddress('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN')}
          className="hover:text-white underline decoration-zinc-700"
        >
          $JUP
        </button>
      </div>
    </div>
  );
};
