/**
 * Auto-Trade Market-Cap Guard
 *
 * Centralizes market-cap range checks for auto-trade flows (re-entry, DCA,
 * and reconciliation). Bounds are configured per-token on AutoTradeTokenConfig.
 * This keeps policy behavior consistent across all auto-trade execution paths.
 */

import type { AutoTradeTokenConfig } from '@nexgent/shared';
import { fetchTokenMetrics } from '@/infrastructure/external/jupiter/index.js';

/**
 * Minimal subset of per-token config needed for the market-cap guard.
 */
export type TokenMarketCapBounds = Pick<AutoTradeTokenConfig, 'marketCapMin' | 'marketCapMax'>;

/**
 * Result of evaluating auto-trade market-cap policy for a token.
 */
export interface AutoTradeMarketCapGuardResult {
  /** Whether trading should proceed for this token. */
  allowed: boolean;
  /** Human-readable explanation for logging and observability. */
  reason: string;
  /** Token market cap reported by Jupiter (USD), if available. */
  marketCap: number | null;
}

/**
 * Check whether per-token market-cap bounds are configured.
 */
export function hasAutoTradeMarketCapBounds(tokenBounds: TokenMarketCapBounds | undefined): boolean {
  if (!tokenBounds) return false;
  return tokenBounds.marketCapMin != null || tokenBounds.marketCapMax != null;
}

/**
 * Evaluate whether auto-trade is allowed for a token under its configured market-cap bounds.
 *
 * Fail-closed policy:
 * - If bounds are configured but market-cap metrics are unavailable, trading is blocked.
 * - If no bounds are configured on this token, the guard allows the trade.
 */
export async function evaluateAutoTradeMarketCapGuard(params: {
  tokenAddress: string;
  tokenBounds: TokenMarketCapBounds | undefined;
}): Promise<AutoTradeMarketCapGuardResult> {
  const { tokenAddress, tokenBounds } = params;

  if (!hasAutoTradeMarketCapBounds(tokenBounds)) {
    return {
      allowed: true,
      reason: 'no_market_cap_bounds_configured',
      marketCap: null,
    };
  }

  const metrics = await fetchTokenMetrics(tokenAddress);
  const marketCap = metrics?.mcap ?? null;

  // Fail-closed when metrics are unavailable and bounds are configured.
  if (marketCap == null) {
    return {
      allowed: false,
      reason: 'market_cap_unavailable',
      marketCap: null,
    };
  }

  if (tokenBounds?.marketCapMin != null && marketCap < tokenBounds.marketCapMin) {
    return {
      allowed: false,
      reason: 'market_cap_below_min',
      marketCap,
    };
  }

  if (tokenBounds?.marketCapMax != null && marketCap > tokenBounds.marketCapMax) {
    return {
      allowed: false,
      reason: 'market_cap_above_max',
      marketCap,
    };
  }

  return {
    allowed: true,
    reason: 'market_cap_in_range',
    marketCap,
  };
}

