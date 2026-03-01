/**
 * Hook / utility for fetching on-chain token metadata from DexScreener.
 *
 * Used by the Auto-Trade Section to resolve a token symbol and logo when
 * the user adds a new token mint address.
 */

export interface TokenMetadata {
  symbol?: string;
  logoUrl?: string;
}

/**
 * Fetch token metadata (symbol, logo) from DexScreener.
 *
 * Returns an empty object if the lookup fails or the token is not found,
 * so callers can always safely destructure.
 */
export async function fetchTokenMetadata(
  address: string,
): Promise<TokenMetadata> {
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
    );
    if (!response.ok) return {};

    const payload = (await response.json()) as {
      pairs?: Array<{
        baseToken?: { address?: string; symbol?: string };
        quoteToken?: { address?: string; symbol?: string };
        info?: { imageUrl?: string };
      }>;
    };
    if (!Array.isArray(payload.pairs)) return {};

    const lower = address.toLowerCase();
    for (const pair of payload.pairs) {
      const baseAddress = pair.baseToken?.address?.toLowerCase();
      const quoteAddress = pair.quoteToken?.address?.toLowerCase();

      if (baseAddress === lower) {
        return {
          symbol: pair.baseToken?.symbol?.trim() || undefined,
          logoUrl: pair.info?.imageUrl?.trim() || undefined,
        };
      }
      if (quoteAddress === lower) {
        return {
          symbol: pair.quoteToken?.symbol?.trim() || undefined,
          logoUrl: pair.info?.imageUrl?.trim() || undefined,
        };
      }
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Convenience hook re-export for components that prefer a named import.
 *
 * Currently a pass-through; a future version could add SWR/React Query
 * caching around the fetch.
 */
export function useTokenMetadata() {
  return { fetchTokenMetadata };
}
