/**
 * Trading config validation tests (per-token auto-trade market-cap bounds).
 */

import { describe, it, expect } from 'vitest';
import { agentTradingConfigSchema } from '../../src/types/trading-config-validation.js';
import { DEFAULT_TRADING_CONFIG } from '../../src/constants/trading-config-defaults.js';

describe('agentTradingConfigSchema per-token auto-trade market-cap bounds', () => {
  const TOKEN_ADDR = 'Token111111111111111111111111111111111111';

  it('accepts valid per-token market-cap range', () => {
    const result = agentTradingConfigSchema.safeParse({
      ...DEFAULT_TRADING_CONFIG,
      autoTrade: {
        enabled: true,
        tokens: [
          { address: TOKEN_ADDR, enabled: true, marketCapMin: 200000, marketCapMax: 5000000 },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts token with no market-cap bounds', () => {
    const result = agentTradingConfigSchema.safeParse({
      ...DEFAULT_TRADING_CONFIG,
      autoTrade: {
        enabled: true,
        tokens: [
          { address: TOKEN_ADDR, enabled: true },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects token when min is greater than max', () => {
    const result = agentTradingConfigSchema.safeParse({
      ...DEFAULT_TRADING_CONFIG,
      autoTrade: {
        enabled: true,
        tokens: [
          { address: TOKEN_ADDR, enabled: true, marketCapMin: 5000000, marketCapMax: 200000 },
        ],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Auto-trade minimum market cap must be ≤ maximum');
    }
  });

  it('allows different bounds on different tokens', () => {
    const result = agentTradingConfigSchema.safeParse({
      ...DEFAULT_TRADING_CONFIG,
      autoTrade: {
        enabled: true,
        tokens: [
          { address: TOKEN_ADDR, enabled: true, marketCapMin: 200000, marketCapMax: 5000000 },
          { address: 'OtherToken1111111111111111111111111111111', enabled: true, marketCapMin: 1000000 },
        ],
      },
    });

    expect(result.success).toBe(true);
  });
});

