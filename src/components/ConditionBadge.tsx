import React from 'react';
import { GMGNConditionCheck } from '../types';

interface ConditionBadgeProps {
  conditions: GMGNConditionCheck[];
  compact?: boolean;
}

export const ConditionBadge: React.FC<ConditionBadgeProps> = ({ conditions, compact = false }) => {
  const passedCount = conditions.filter((c) => c.passed).length;
  const totalCount = conditions.length;
  const allPassed = passedCount === totalCount;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={`px-2 py-0.5 text-xs font-mono rounded border ${
            allPassed
              ? 'bg-white text-black border-white font-semibold'
              : 'bg-zinc-900 text-zinc-400 border-zinc-800'
          }`}
        >
          {passedCount}/{totalCount} CONDITIONS
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t border-zinc-900">
      {conditions.map((c) => (
        <div
          key={c.id}
          className={`p-2 rounded border text-xs flex flex-col justify-between transition-colors ${
            c.passed
              ? 'bg-zinc-950/80 border-white/20 text-zinc-200'
              : 'bg-zinc-950/40 border-zinc-900 text-zinc-500'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className={`font-medium ${c.passed ? 'text-white' : 'text-zinc-400'}`}>
              {c.name}
            </span>
            <span
              className={`px-1.5 py-0.2 text-[10px] font-mono font-semibold rounded ${
                c.passed
                  ? 'bg-white text-black'
                  : 'bg-zinc-900 text-zinc-500'
              }`}
            >
              {c.passed ? 'PASS' : 'FAIL'}
            </span>
          </div>
          <div className="font-mono text-[11px] text-zinc-400 truncate">
            {c.actualValue}
          </div>
        </div>
      ))}
    </div>
  );
};
