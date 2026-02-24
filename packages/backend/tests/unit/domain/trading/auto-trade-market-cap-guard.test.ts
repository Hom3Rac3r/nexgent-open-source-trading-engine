/**
 * Auto-Trade Market-Cap Guard Unit Tests
 *
 * Validates fail-closed per-token market-cap policy used by auto-trade flows.
 */

import { evaluateAutoTradeMarketCapGuard, hasAutoTradeMarketCapBounds } from '@/domain/trading/auto-trade-market-cap-guard.js';

jest.mock('@/infrastructure/external/jupiter/index.js', () => ({
  fetchTokenMetrics: jest.fn(),
}));

describe('auto-trade market-cap guard (per-token bounds)', () => {
  let mockFetchTokenMetrics: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    const jupiterModule = await import('@/infrastructure/external/jupiter/index.js');
    mockFetchTokenMetrics = jupiterModule.fetchTokenMetrics as jest.Mock;
  });

  it('returns true when no bounds configured on token', async () => {
    const result = await evaluateAutoTradeMarketCapGuard({
      tokenAddress: 'Token111111111111111111111111111111111111',
      tokenBounds: {},
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('no_market_cap_bounds_configured');
    expect(mockFetchTokenMetrics).not.toHaveBeenCalled();
  });

  it('returns true when tokenBounds is undefined', async () => {
    const result = await evaluateAutoTradeMarketCapGuard({
      tokenAddress: 'Token111111111111111111111111111111111111',
      tokenBounds: undefined,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('no_market_cap_bounds_configured');
  });

  it('fails closed when bounds are configured but metrics are unavailable', async () => {
    mockFetchTokenMetrics.mockResolvedValueOnce(null);

    const result = await evaluateAutoTradeMarketCapGuard({
      tokenAddress: 'Token111111111111111111111111111111111111',
      tokenBounds: { marketCapMin: 200_000, marketCapMax: 5_000_000 },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('market_cap_unavailable');
    expect(result.marketCap).toBeNull();
  });

  it('blocks token when market cap is below minimum', async () => {
    mockFetchTokenMetrics.mockResolvedValueOnce({ mcap: 100_000, liquidity: 1_000_000, holderCount: 1000 });

    const result = await evaluateAutoTradeMarketCapGuard({
      tokenAddress: 'Token111111111111111111111111111111111111',
      tokenBounds: { marketCapMin: 200_000 },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('market_cap_below_min');
    expect(result.marketCap).toBe(100_000);
  });

  it('blocks token when market cap is above maximum', async () => {
    mockFetchTokenMetrics.mockResolvedValueOnce({ mcap: 8_000_000, liquidity: 1_000_000, holderCount: 1000 });

    const result = await evaluateAutoTradeMarketCapGuard({
      tokenAddress: 'Token111111111111111111111111111111111111',
      tokenBounds: { marketCapMax: 5_000_000 },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('market_cap_above_max');
    expect(result.marketCap).toBe(8_000_000);
  });

  it('allows token when market cap is within configured range', async () => {
    mockFetchTokenMetrics.mockResolvedValueOnce({ mcap: 1_500_000, liquidity: 1_000_000, holderCount: 1000 });

    const result = await evaluateAutoTradeMarketCapGuard({
      tokenAddress: 'Token111111111111111111111111111111111111',
      tokenBounds: { marketCapMin: 200_000, marketCapMax: 5_000_000 },
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('market_cap_in_range');
    expect(result.marketCap).toBe(1_500_000);
  });

  it('detects when per-token market-cap bounds are configured', () => {
    expect(hasAutoTradeMarketCapBounds(undefined)).toBe(false);
    expect(hasAutoTradeMarketCapBounds({})).toBe(false);
    expect(hasAutoTradeMarketCapBounds({ marketCapMin: 1 })).toBe(true);
    expect(hasAutoTradeMarketCapBounds({ marketCapMax: 5_000_000 })).toBe(true);
    expect(hasAutoTradeMarketCapBounds({ marketCapMin: 200_000, marketCapMax: 5_000_000 })).toBe(true);
  });
});

