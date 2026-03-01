/**
 * Jupiter Token Metrics Service Unit Tests
 */

import { fetchTokenMetrics, clearTokenMetricsCache } from '@/infrastructure/external/jupiter/jupiter-token-metrics.service.js';

const originalEnv = process.env;

describe('fetchTokenMetrics', () => {
  const mockTokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  beforeEach(() => {
    jest.resetModules();
    clearTokenMetricsCache();
    process.env = { ...originalEnv, JUPITER_API_KEY: 'test-api-key' };
    (global as any).fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return token metrics when API returns valid data', async () => {
    (global as any).fetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: mockTokenAddress,
            mcap: 45_000_000_000,
            liquidity: 50_000_000,
            holderCount: 2_500_000,
          },
        ]),
    });

    const result = await fetchTokenMetrics(mockTokenAddress);

    expect(result).toEqual({
      mcap: 45_000_000_000,
      liquidity: 50_000_000,
      holderCount: 2_500_000,
    });
    expect((global as any).fetch).toHaveBeenCalledWith(
      `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mockTokenAddress)}`,
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-api-key': 'test-api-key', 'Content-Type': 'application/json' },
      })
    );
  });

  it('should return null when API returns empty array', async () => {
    (global as any).fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const result = await fetchTokenMetrics(mockTokenAddress);

    expect(result).toBeNull();
  });

  it('should return null when API returns non-ok status', async () => {
    (global as any).fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const result = await fetchTokenMetrics(mockTokenAddress);

    expect(result).toBeNull();
  });

  it('should return null when JUPITER_API_KEY is not set', async () => {
    const prev = process.env.JUPITER_API_KEY;
    process.env.JUPITER_API_KEY = '';

    const result = await fetchTokenMetrics(mockTokenAddress);

    process.env.JUPITER_API_KEY = prev;
    expect(result).toBeNull();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
