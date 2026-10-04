import { DexscreenerPair } from '../src/types';
export type { DexscreenerPair };

export interface TokenPairHint {
  pairAddress?: string;
  dexId?: string;
}

export class DexscreenerClient {
  private cache = new Map<string, { data: DexscreenerPair; timestamp: number }>();
  private CACHE_TTL_MS = 1500; // 1.5s cache for fast reactivity
  private cachedSolPriceUsd: number = 140;
  private lastSolPriceTime: number = 0;

  /**
   * Fetches real-time SOL price in USD with automatic caching (15s TTL)
   */
  public async getSolPriceUsd(): Promise<number> {
    if (this.cachedSolPriceUsd > 0 && Date.now() - this.lastSolPriceTime < 15000) {
      return this.cachedSolPriceUsd;
    }
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112?t=${Date.now()}`,
        {
          headers: { 'User-Agent': 'SolSnipe/2.0' },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (res.ok) {
        const json = await res.json();
        if (json.pairs && Array.isArray(json.pairs) && json.pairs.length > 0) {
          const usdcPair =
            json.pairs.find(
              (p: any) =>
                p.chainId === 'solana' &&
                (p.quoteToken?.symbol === 'USDC' || p.quoteToken?.symbol === 'USDT')
            ) || json.pairs[0];
          const price = Number(usdcPair?.priceUsd);
          if (price > 10 && price < 2000) {
            this.cachedSolPriceUsd = price;
            this.lastSolPriceTime = Date.now();
            return price;
          }
        }
      }
    } catch (err) {
      console.warn('[DexscreenerClient] Could not fetch SOL price feed, using cached:', err);
    }
    return this.cachedSolPriceUsd || 140;
  }

  /**
   * Calculates a comprehensive score for a DEX pair to ensure the legitimate, active,
   * high-liquidity pool is selected rather than disconnected or spoofed pools.
   */
  public calculatePairScore(pair: DexscreenerPair, hint?: TokenPairHint): number {
    let score = 0;

    // 1. Absolute Priority: If this pair matches the position's exact pair address
    if (hint?.pairAddress && pair.pairAddress?.toLowerCase() === hint.pairAddress.toLowerCase()) {
      score += 10_000_000;
    }

    // 2. Preferred DEX (e.g. pumpfun if entered via pumpfun bonding curve)
    if (hint?.dexId && pair.dexId?.toLowerCase() === hint.dexId.toLowerCase()) {
      score += 200_000;
    }

    // 3. Quoted in SOL/WSOL
    const isSolQuote =
      pair.quoteToken?.address === 'So11111111111111111111111111111111111111112' ||
      pair.quoteToken?.symbol?.toUpperCase() === 'SOL' ||
      pair.quoteToken?.symbol?.toUpperCase() === 'WSOL';

    if (isSolQuote) {
      score += 50_000;
    }

    // 4. Effective Liquidity
    // NOTE: Dexscreener reports liquidity.usd = undefined for pump.fun bonding curves,
    // even though the bonding curve holds real SOL liquidity (30-85 SOL = ~$4,500 to $12,000+).
    let effectiveLiquidityUsd = Number(pair.liquidity?.usd || 0);

    const isPumpFun =
      pair.dexId === 'pumpfun' ||
      pair.baseToken?.address?.endsWith('pump') ||
      pair.url?.includes('pumpfun');

    if (isPumpFun && (!pair.liquidity || !pair.liquidity.usd)) {
      const mcap = pair.marketCap || pair.fdv || 0;
      // Pumpfun bonding curve SOL depth is ~20% of current market cap
      effectiveLiquidityUsd = mcap > 0 ? Math.min(70000, Math.max(3500, mcap * 0.2)) : 3500;
    }

    score += Math.min(effectiveLiquidityUsd, 200_000);

    // 5. Real-Time Trading Activity & Volume
    // Spoof / disconnected pools have near-0 volume and txns, while real pools have high activity!
    const vol24h = Number(pair.volume?.h24 || 0);
    const vol5m = Number(pair.volume?.m5 || 0);
    const txns24h = Number(pair.txns?.h24?.buys || 0) + Number(pair.txns?.h24?.sells || 0);
    const txns5m = Number(pair.txns?.m5?.buys || 0) + Number(pair.txns?.m5?.sells || 0);

    score += Math.min(vol24h * 0.1, 50_000);
    score += Math.min(vol5m * 5, 20_000);
    score += Math.min(txns24h * 5, 30_000);
    score += Math.min(txns5m * 50, 20_000);

    return score;
  }

  /**
   * Fetches pair data directly using the pair's on-chain contract address
   */
  public async getPairByAddress(pairAddress: string): Promise<DexscreenerPair | null> {
    const cleanAddr = pairAddress.trim();
    if (!cleanAddr) return null;

    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${cleanAddr}?t=${Date.now()}`, {
        headers: {
          'User-Agent': 'SolSnipe/2.0 (Realtime Pair Stream)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) return null;

      const json = await res.json();
      if (json.pair) return json.pair;
      if (Array.isArray(json.pairs) && json.pairs.length > 0) return json.pairs[0];
    } catch (err) {
      console.warn(`[DexscreenerClient] Error fetching pair by address ${cleanAddr}:`, err);
    }
    return null;
  }

  /**
   * Fetches best trading pair for a given token mint address
   */
  public async getTokenPair(
    tokenAddress: string,
    hint?: TokenPairHint
  ): Promise<DexscreenerPair | null> {
    const cleanAddress = tokenAddress.trim();
    const cacheKey = hint?.pairAddress ? `${cleanAddress}:${hint.pairAddress}` : cleanAddress;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    // If an exact pairAddress is pinned, attempt direct pair retrieval first
    if (hint?.pairAddress) {
      const direct = await this.getPairByAddress(hint.pairAddress);
      if (direct && Number(direct.priceUsd) > 0) {
        this.cache.set(cacheKey, { data: direct, timestamp: Date.now() });
        return direct;
      }
    }

    try {
      // Append timestamp query parameter to bypass Cloudflare 30s CDN cache
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cleanAddress}?t=${Date.now()}`, {
        headers: {
          'User-Agent': 'SolSnipe/2.0 (Realtime Dexscreener Price Stream)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return null;
      }

      const json = await res.json();
      if (!json.pairs || json.pairs.length === 0) {
        return null;
      }

      // Filter for Solana chain
      const solanaPairs: DexscreenerPair[] = json.pairs.filter((p: any) => p.chainId === 'solana');
      if (solanaPairs.length === 0) {
        const first = json.pairs[0];
        if (first) this.cache.set(cacheKey, { data: first, timestamp: Date.now() });
        return first || null;
      }

      // Rank pairs using intelligent scoring (matching hint pairAddress, volume, real liquidity)
      const rankedPairs = [...solanaPairs].sort((a, b) => {
        return this.calculatePairScore(b, hint) - this.calculatePairScore(a, hint);
      });

      const bestPair = rankedPairs[0];
      this.cache.set(cacheKey, { data: bestPair, timestamp: Date.now() });
      return bestPair;
    } catch (err) {
      console.warn(`[DexscreenerClient] Error fetching token pair for ${cleanAddress}:`, err);
      return null;
    }
  }

  /**
   * Fetches multiple token pairs in batch with anti-cache query parameters
   * and optional position hints (pairAddress, dexId) to prevent pool jumping
   */
  public async getBatchTokenPairs(
    tokenAddresses: string[],
    hints?: Map<string, TokenPairHint>
  ): Promise<Map<string, DexscreenerPair>> {
    const results = new Map<string, DexscreenerPair>();
    if (tokenAddresses.length === 0) return results;

    // Dexscreener allows up to 30 addresses comma-separated
    const chunks: string[][] = [];
    for (let i = 0; i < tokenAddresses.length; i += 30) {
      chunks.push(tokenAddresses.slice(i, i + 30));
    }

    for (const chunk of chunks) {
      try {
        const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}?t=${Date.now()}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'SolSnipe/2.0' },
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const json = await res.json();
          if (json.pairs && Array.isArray(json.pairs)) {
            for (const pair of json.pairs) {
              if (pair.chainId !== 'solana') continue;
              const baseAddr = pair.baseToken?.address;
              if (!baseAddr) continue;

              const hint = hints?.get(baseAddr);
              const existing = results.get(baseAddr);

              if (!existing) {
                results.set(baseAddr, pair);
                this.cache.set(baseAddr, { data: pair, timestamp: Date.now() });
              } else {
                const existingScore = this.calculatePairScore(existing, hint);
                const currentScore = this.calculatePairScore(pair, hint);

                if (currentScore > existingScore) {
                  results.set(baseAddr, pair);
                  this.cache.set(baseAddr, { data: pair, timestamp: Date.now() });
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('[DexscreenerClient] Batch fetch error:', err);
      }
    }

    return results;
  }
}
