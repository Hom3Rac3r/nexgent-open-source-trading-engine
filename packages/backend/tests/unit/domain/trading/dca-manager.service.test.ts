/**
 * DCA Manager Service Unit Tests
 * 
 * Tests the DCA (Dollar Cost Averaging) evaluation and calculation logic.
 */

import { dcaManager } from '@/domain/trading/dca-manager.service.js';
import {
  createMockConfig,
  createMockPosition,
  createMockPositionWithDCA,
  createMockDCAConfig,
  createMockDCALevel,
} from '../../../helpers/test-factory.js';
import type { AgentTradingConfig, DCAConfig } from '@nexgent/shared';

// Mock logger - must be before other mocks to avoid reference errors
jest.mock('@/infrastructure/logging/logger.js', () => {
  const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  return {
    __esModule: true,
    default: mockLogger,
    logger: mockLogger,
  };
});

// Mock dependencies
jest.mock('@/domain/trading/config-service.js', () => ({
  configService: {
    loadAgentConfig: jest.fn(),
  },
}));

jest.mock('@/infrastructure/cache/redis-config-service.js', () => ({
  redisConfigService: {
    getAgentConfig: jest.fn(),
  },
}));

describe('DCAManager', () => {
  let mockConfig: AgentTradingConfig;
  let mockConfigService: any;
  let mockRedisConfigService: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create mock config with DCA enabled
    mockConfig = createMockConfig({
      dca: createMockDCAConfig({ enabled: true }),
    });

    // Get mocked services
    const configServiceModule = await import('@/domain/trading/config-service.js');
    mockConfigService = configServiceModule.configService;

    const redisConfigServiceModule = await import('@/infrastructure/cache/redis-config-service.js');
    mockRedisConfigService = redisConfigServiceModule.redisConfigService;

    // Setup default mocks
    mockRedisConfigService.getAgentConfig.mockResolvedValue(mockConfig);
    mockConfigService.loadAgentConfig.mockResolvedValue(mockConfig);
  });

  describe('evaluateDCA', () => {
    describe('basic checks', () => {
      it('should return no trigger when DCA is disabled', async () => {
        // Arrange
        const position = createMockPositionWithDCA();
        const currentPrice = 0.0008; // 20% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({ enabled: false }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.triggerLevel).toBeNull();
        expect(result.buyAmountSol).toBeNull();
        expect(result.reason).toBe('DCA disabled');
      });

      it('should return no trigger when max DCA count reached', async () => {
        // Arrange
        const position = createMockPositionWithDCA({ dcaCount: 3 });
        const currentPrice = 0.0005; // Large drop
        const config = createMockConfig({
          dca: createMockDCAConfig({ enabled: true, maxDCACount: 3 }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.reason).toContain('All DCA levels used');
      });

      it('should return no trigger during cooldown period', async () => {
        // Arrange
        const tenSecondsAgo = new Date(Date.now() - 10 * 1000);
        const position = createMockPositionWithDCA({
          lastDcaTime: tenSecondsAgo,
          dcaCount: 1,
        });
        const currentPrice = 0.0005; // Large drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            cooldownSeconds: 30,
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.reason).toContain('Cooldown active');
        expect(result.reason).toMatch(/\d+s remaining/);
      });

      it('should allow trigger when cooldown has expired', async () => {
        // Arrange
        const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
        const position = createMockPositionWithDCA({
          lastDcaTime: sixtySecondsAgo,
          dcaCount: 0,
        });
        const currentPrice = 0.0008; // 20% drop from 0.001
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            cooldownSeconds: 30,
            mode: 'moderate', // First level at -20%
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
      });

      it('should return no trigger when no levels configured in custom mode', async () => {
        // Arrange
        const position = createMockPositionWithDCA();
        const currentPrice = 0.0005; // Large drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'custom',
            levels: [],
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.reason).toBe('No DCA levels configured');
      });

      it('should allow trigger when no previous DCA (null lastDcaTime)', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          lastDcaTime: null,
          dcaCount: 0,
        });
        const currentPrice = 0.0008; // 20% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate',
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
      });
    });

    describe('price drop evaluation', () => {
      it('should not trigger when price has not dropped enough', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001, // avg price
          dcaCount: 0,
        });
        const currentPrice = 0.00095; // Only 5% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate', // First level at -20%
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.reason).toContain('has not reached next level');
      });

      it('should trigger when price drops to first DCA level', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          purchaseAmount: 1000,
          dcaCount: 0,
        });
        const currentPrice = 0.00079; // 21% drop (below -20% threshold)
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate', // First level: -20% drop, 75% buy
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerLevel).not.toBeNull();
        expect(result.triggerLevel?.dropPercent).toBe(-20);
        expect(result.triggerLevel?.buyPercent).toBe(75);
        expect(result.buyAmountSol).toBeGreaterThan(0);
      });

      it('should trigger exactly at threshold', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          purchaseAmount: 1000,
          dcaCount: 0,
        });
        const currentPrice = 0.0008; // Exactly 20% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate',
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
      });

      it('should use second level after first DCA', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          purchaseAmount: 1500, // After first DCA
          dcaCount: 1,
        });
        const currentPrice = 0.0008; // 20% drop (second level for moderate is also -20% from new avg)
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate', // Second level: -20% drop, 75% buy
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerLevel?.dropPercent).toBe(-20);
        expect(result.triggerLevel?.buyPercent).toBe(75);
      });

      it('should not trigger second level if drop not deep enough', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 1, // Already did first DCA
        });
        const currentPrice = 0.00085; // Only 15% drop (need -20% for second level)
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate', // Need -20% for second level
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.reason).toContain('has not reached next level');
      });

      it('should return exhausted when all levels used', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 2, // Moderate has 2 levels
        });
        const currentPrice = 0.0003; // 70% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate',
            maxDCACount: 5, // Allow more than 2
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.reason).toContain('All DCA levels used');
      });
    });

    describe('mode handling', () => {
      it('should use aggressive levels when mode is aggressive', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 0,
        });
        const currentPrice = 0.00089; // 11% drop (first aggressive level is -10%)
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'aggressive',
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerLevel?.dropPercent).toBe(-10);
        expect(result.triggerLevel?.buyPercent).toBe(100);
      });

      it('should use conservative levels when mode is conservative', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 0,
        });
        const currentPrice = 0.00085; // 15% drop (not enough for conservative -20%)
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'conservative',
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
      });

      it('should trigger conservative at -20%', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 0,
        });
        const currentPrice = 0.0008; // 20% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'conservative',
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerLevel?.dropPercent).toBe(-20);
        expect(result.triggerLevel?.buyPercent).toBe(100); // Conservative uses 100%
      });

      it('should use custom levels when mode is custom', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 0,
        });
        const currentPrice = 0.00087; // 13% drop (below -12% threshold)
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'custom',
            levels: [
              { dropPercent: -12, buyPercent: 30 },
              { dropPercent: -25, buyPercent: 60 },
            ],
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerLevel?.dropPercent).toBe(-12);
        expect(result.triggerLevel?.buyPercent).toBe(30);
      });

      it('should sort custom levels correctly (least negative first)', async () => {
        // Arrange - custom levels in wrong order
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 0,
        });
        const currentPrice = 0.00088; // 12% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'custom',
            levels: [
              { dropPercent: -30, buyPercent: 100 }, // Should be last
              { dropPercent: -10, buyPercent: 25 },  // Should be first
              { dropPercent: -20, buyPercent: 50 },  // Should be middle
            ],
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert - should match -10% level (first after sorting)
        expect(result.shouldTrigger).toBe(true);
        expect(result.triggerLevel?.dropPercent).toBe(-10);
      });
    });

    describe('buy amount calculation', () => {
      it('should calculate correct buy amount as percentage of position value', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          purchaseAmount: 1000, // 1000 tokens
          dcaCount: 0,
        });
        const currentPrice = 0.0008; // 20% drop, position value = 0.80 SOL
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate', // 75% buy at -20%
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        // Position value = 0.0008 * 1000 = 0.80 SOL
        // Buy amount = 0.80 * 0.75 = 0.60 SOL
        expect(result.buyAmountSol).toBeCloseTo(0.60, 3);
      });

      it('should calculate larger buy amount at deeper drop levels', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          purchaseAmount: 1000,
          dcaCount: 1, // After first DCA
        });
        const currentPrice = 0.0008; // 20% drop from new avg, position value = 0.8 SOL
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate', // 75% buy at -20% (second level)
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        // Position value = 0.0008 * 1000 = 0.8 SOL
        // Buy amount = 0.8 * 0.75 = 0.60 SOL
        expect(result.buyAmountSol).toBeCloseTo(0.60, 3);
      });

      it('should calculate 100% buy amount (double down)', async () => {
        // Arrange - use aggressive mode which has 100% buy
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          purchaseAmount: 1000,
          dcaCount: 0,
        });
        const currentPrice = 0.0009; // 10% drop (aggressive first level)
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'aggressive', // 100% buy at -10%
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        // Position value = 0.0009 * 1000 = 0.90 SOL
        // Buy amount = 0.90 * 1.00 = 0.90 SOL
        expect(result.buyAmountSol).toBeCloseTo(0.90, 3);
      });
    });

    describe('config loading', () => {
      it('should load config from Redis if not provided', async () => {
        // Arrange
        const position = createMockPositionWithDCA();
        const currentPrice = 0.0008;

        const configWithDCA = createMockConfig({
          dca: createMockDCAConfig({ enabled: true, mode: 'moderate' }),
        });
        mockRedisConfigService.getAgentConfig.mockResolvedValue(configWithDCA);

        // Act
        await dcaManager.evaluateDCA(position, currentPrice);

        // Assert
        expect(mockRedisConfigService.getAgentConfig).toHaveBeenCalledWith(position.agentId);
      });

      it('should fallback to DB config if Redis returns null', async () => {
        // Arrange
        const position = createMockPositionWithDCA();
        const currentPrice = 0.0008;

        mockRedisConfigService.getAgentConfig.mockResolvedValue(null);
        const configWithDCA = createMockConfig({
          dca: createMockDCAConfig({ enabled: true }),
        });
        mockConfigService.loadAgentConfig.mockResolvedValue(configWithDCA);

        // Act
        await dcaManager.evaluateDCA(position, currentPrice);

        // Assert
        expect(mockConfigService.loadAgentConfig).toHaveBeenCalledWith(position.agentId);
      });

      it('should use provided config without loading', async () => {
        // Arrange
        const position = createMockPositionWithDCA();
        const currentPrice = 0.0008;
        const config = createMockConfig({
          dca: createMockDCAConfig({ enabled: false }),
        });

        // Act
        await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(mockRedisConfigService.getAgentConfig).not.toHaveBeenCalled();
        expect(mockConfigService.loadAgentConfig).not.toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('should handle very small price values', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.000000001,
          purchaseAmount: 1000000000,
          totalInvestedSol: 1.0,
          dcaCount: 0,
        });
        const currentPrice = 0.0000000008; // 20% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate',
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(true);
        expect(result.buyAmountSol).toBeGreaterThan(0);
      });

      it('should handle price increase (no DCA)', async () => {
        // Arrange
        const position = createMockPositionWithDCA({
          purchasePrice: 0.001,
          dcaCount: 0,
        });
        const currentPrice = 0.0015; // 50% gain
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate',
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert
        expect(result.shouldTrigger).toBe(false);
        expect(result.reason).toContain('has not reached');
      });

      it('should handle zero dcaCount with lastDcaTime set', async () => {
        // Edge case: lastDcaTime set but dcaCount is 0 (shouldn't happen, but handle gracefully)
        const sixtySecondsAgo = new Date(Date.now() - 60 * 1000);
        const position = createMockPositionWithDCA({
          lastDcaTime: sixtySecondsAgo,
          dcaCount: 0,
        });
        const currentPrice = 0.0008; // 20% drop
        const config = createMockConfig({
          dca: createMockDCAConfig({
            enabled: true,
            mode: 'moderate',
            cooldownSeconds: 30,
          }),
        });

        // Act
        const result = await dcaManager.evaluateDCA(position, currentPrice, config);

        // Assert - cooldown expired, should trigger first level
        expect(result.shouldTrigger).toBe(true);
      });
    });
  });

  describe('calculateNewAveragePrice', () => {
    it('should calculate weighted average correctly after first DCA', () => {
      // Arrange
      const existingTotalSol = 1.0;
      const existingTokenAmount = 1000;
      const newSolSpent = 0.5;
      const newTokensAcquired = 600; // Better price due to drop

      // Act
      const result = dcaManager.calculateNewAveragePrice(
        existingTotalSol,
        existingTokenAmount,
        newSolSpent,
        newTokensAcquired
      );

      // Assert
      // New total invested = 1.0 + 0.5 = 1.5 SOL
      // New total amount = 1000 + 600 = 1600 tokens
      // New avg = 1.5 / 1600 = 0.0009375
      expect(result.newTotalInvested).toBeCloseTo(1.5, 6);
      expect(result.newTotalAmount).toBeCloseTo(1600, 6);
      expect(result.newAveragePrice).toBeCloseTo(0.0009375, 9);
    });

    it('should lower average price when buying at lower price', () => {
      // Arrange
      // Original: 1000 tokens at 0.001 SOL each = 1 SOL
      // DCA: 1000 tokens at 0.0008 SOL each = 0.8 SOL
      const existingTotalSol = 1.0;
      const existingTokenAmount = 1000;
      const newSolSpent = 0.8;
      const newTokensAcquired = 1000;

      // Act
      const result = dcaManager.calculateNewAveragePrice(
        existingTotalSol,
        existingTokenAmount,
        newSolSpent,
        newTokensAcquired
      );

      // Assert
      // New avg = 1.8 / 2000 = 0.0009
      expect(result.newAveragePrice).toBeCloseTo(0.0009, 9);
      expect(result.newAveragePrice).toBeLessThan(0.001); // Lower than original
    });

    it('should handle the example from user requirements', () => {
      // User example: bought 331657.884578 for 0.000004973891518059 each,
      // then 162108.802412 for 0.000004769626284913 each

      // First purchase
      const firstTokens = 331657.884578;
      const firstPrice = 0.000004973891518059;
      const firstSol = firstTokens * firstPrice; // ~1.6497 SOL

      // Second purchase (DCA)
      const secondTokens = 162108.802412;
      const secondPrice = 0.000004769626284913;
      const secondSol = secondTokens * secondPrice; // ~0.7732 SOL

      // Act
      const result = dcaManager.calculateNewAveragePrice(
        firstSol,
        firstTokens,
        secondSol,
        secondTokens
      );

      // Assert
      // Total SOL: ~2.4229
      // Total tokens: ~493766.69
      // New avg: ~0.000004907 per token
      expect(result.newTotalAmount).toBeCloseTo(493766.686990, 2);
      expect(result.newTotalInvested).toBeCloseTo(2.42298, 3);
      expect(result.newAveragePrice).toBeCloseTo(0.000004907, 9);
    });

    it('should handle multiple DCAs correctly', () => {
      // First: 1000 tokens at 0.001
      let totalSol = 1.0;
      let totalTokens = 1000;

      // First DCA: buy 800 tokens at 0.0008
      let result = dcaManager.calculateNewAveragePrice(totalSol, totalTokens, 0.64, 800);
      totalSol = result.newTotalInvested;
      totalTokens = result.newTotalAmount;

      expect(result.newAveragePrice).toBeCloseTo(0.000911, 6); // Avg lowered

      // Second DCA: buy 1000 tokens at 0.0006
      result = dcaManager.calculateNewAveragePrice(totalSol, totalTokens, 0.6, 1000);

      expect(result.newTotalAmount).toBe(2800);
      expect(result.newTotalInvested).toBeCloseTo(2.24, 2);
      expect(result.newAveragePrice).toBeCloseTo(0.0008, 4); // Avg further lowered
    });

    it('should handle very small token amounts', () => {
      // Act
      const result = dcaManager.calculateNewAveragePrice(
        0.001, // 0.001 SOL
        100,   // 100 tokens
        0.0005, // 0.0005 SOL
        60     // 60 tokens
      );

      // Assert
      expect(result.newTotalInvested).toBeCloseTo(0.0015, 6);
      expect(result.newTotalAmount).toBe(160);
      expect(result.newAveragePrice).toBeCloseTo(0.0015 / 160, 9);
    });

    it('should handle large token amounts', () => {
      // Act
      const result = dcaManager.calculateNewAveragePrice(
        100000,       // 100k SOL
        1e12,         // 1 trillion tokens
        50000,        // 50k SOL
        0.8e12        // 800 billion tokens
      );

      // Assert
      expect(result.newTotalInvested).toBe(150000);
      expect(result.newTotalAmount).toBe(1.8e12);
      // New avg = 150000 / 1.8e12 = 0.0000000833...
      expect(result.newAveragePrice).toBeCloseTo(150000 / 1.8e12, 15);
    });
  });
});
