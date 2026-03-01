/**
 * Stop Loss Manager Service Unit Tests
 * 
 * Tests the stop loss calculation and evaluation logic.
 */

// Jest globals are available without import
import { stopLossManager } from '@/domain/trading/stop-loss-manager.service.js';
import { createMockConfig, createMockPosition } from '../../../helpers/test-factory.js';
import type { AgentTradingConfig } from '@nexgent/shared';

// Mock dependencies
jest.mock('@/domain/trading/position-service.js', () => ({
  positionService: {
    updatePosition: jest.fn(),
    getPositionById: jest.fn(),
  },
}));

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

jest.mock('@/infrastructure/cache/redis-client.js', () => ({
  redisService: {
    acquireLock: jest.fn().mockResolvedValue('mock-lock-token'), // Default: successfully acquire lock
    releaseLock: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn(),
  },
}));

// Mock logger - needs to work with dynamic import
// Create the mock object first
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

// Mock the module
jest.mock('@/infrastructure/logging/logger.js', () => {
  return {
    __esModule: true,
    default: mockLogger,
    logger: mockLogger,
  };
});

describe('StopLossManager', () => {
  let mockConfig: AgentTradingConfig;
  let mockPositionService: any;
  let mockConfigService: any;
  let mockRedisConfigService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Create mock config
    mockConfig = createMockConfig();
    
    // Get mocked services
    const positionServiceModule = await import('@/domain/trading/position-service.js');
    mockPositionService = positionServiceModule.positionService;
    
    const configServiceModule = await import('@/domain/trading/config-service.js');
    mockConfigService = configServiceModule.configService;
    
    const redisConfigServiceModule = await import('@/infrastructure/cache/redis-config-service.js');
    mockRedisConfigService = redisConfigServiceModule.redisConfigService;
    
    // Setup default mocks
    mockRedisConfigService.getAgentConfig.mockResolvedValue(mockConfig);
    mockConfigService.loadAgentConfig.mockResolvedValue(mockConfig);
    mockPositionService.updatePosition.mockResolvedValue(undefined);
    // getPositionById returns the position passed to evaluateStopLoss by default
    mockPositionService.getPositionById.mockImplementation((id: string) => {
      // Return a basic position - tests can override this
      return Promise.resolve(createMockPosition({ id }));
    });
  });

  describe('initializeStopLoss', () => {
    it('should initialize stop loss with default percentage when enabled', async () => {
      // Arrange
      const positionId = 'position-123';
      const purchasePrice = 100;
      const config = createMockConfig({ 
        stopLoss: { 
          enabled: true, 
          defaultPercentage: -32,
          trailingLevels: [],
          mode: 'custom' as const,
        } 
      });
      
      // Act
      const result = await stopLossManager.initializeStopLoss(positionId, purchasePrice, config);
      
      // Assert
      expect(result).toBe(-32);
      expect(mockPositionService.updatePosition).toHaveBeenCalledWith(positionId, {
        currentStopLossPercentage: -32,
        peakPrice: purchasePrice,
        lastStopLossUpdate: expect.any(Date),
      });
    });

    it('should return undefined when stop loss is disabled', async () => {
      // Arrange
      const positionId = 'position-123';
      const purchasePrice = 100;
      const config = createMockConfig({ 
        stopLoss: { 
          enabled: false,
          defaultPercentage: -32,
          trailingLevels: [],
          mode: 'custom' as const,
        } 
      });
      
      // Act
      const result = await stopLossManager.initializeStopLoss(positionId, purchasePrice, config);
      
      // Assert
      expect(result).toBeUndefined();
      expect(mockPositionService.updatePosition).not.toHaveBeenCalled();
    });
  });

  describe('evaluateStopLoss', () => {
    it('should return no trigger when stop loss is disabled', async () => {
      // Arrange
      const position = createMockPosition({ purchasePrice: 100, currentStopLossPercentage: -32 });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 50; // 50% loss
      const config = createMockConfig({ 
        stopLoss: { 
          enabled: false,
          defaultPercentage: -32,
          trailingLevels: [],
          mode: 'custom' as const,
        } 
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      expect(result.shouldTrigger).toBe(false);
      expect(result.currentStopLossPercentage).toBeNull();
      expect(result.stopLossPrice).toBeNull();
      expect(result.updated).toBe(false);
    });

    it('should trigger stop loss when price drops below default threshold', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: -32,
        peakPrice: 100,
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 68; // 32% loss (should trigger at -32%)
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      expect(result.shouldTrigger).toBe(true);
      expect(result.currentStopLossPercentage).toBe(-32);
      expect(result.stopLossPrice).toBe(68); // 100 * (1 - 0.32) = 68
    });

    it('should not trigger stop loss when price is above threshold', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: -32,
        peakPrice: 100,
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 80; // 20% loss (above -32% threshold)
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      expect(result.shouldTrigger).toBe(false);
      expect(result.currentStopLossPercentage).toBe(-32);
      expect(result.stopLossPrice).toBe(68);
    });

    it('should update peak price when current price exceeds peak', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: -32,
        peakPrice: 100,
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      // Use a price that's above the stop loss price (190 = 100 * 1.90)
      // Current price needs to be > 190 to not trigger
      const currentPrice = 200; // 100% gain, above stop loss price of 190
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [{ change: 50, stopLoss: 90 }],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      expect(result.shouldTrigger).toBe(false); // 200 > 190, so should not trigger
      expect(result.updated).toBe(true);
      expect(mockPositionService.updatePosition).toHaveBeenCalledWith(
        position.id,
        expect.objectContaining({
          peakPrice: 200,
          currentStopLossPercentage: 90, // Should use trailing level (90% gain from purchase)
        })
      );
    });

    it('should apply trailing stop loss when price increases', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: -32, // Starting at default
        peakPrice: 200, // Already at 100% gain (200/100 = 2x = 100% gain)
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      // Stop loss price = 100 * 1.95 = 195, so use a price above that
      const currentPrice = 198; // Current price is below peak but still above stop loss (195)
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [
            { change: 50, stopLoss: 90 }, // Match at 50% gain
            { change: 100, stopLoss: 95 }, // Match at 100% gain (peak is at 100%)
          ],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      expect(result.shouldTrigger).toBe(false); // 198 > 195, so should not trigger
      // Peak is 200 (100% gain from purchase), so should match trailing level for 100% change -> 95%
      // Stop loss is calculated from purchase: 100 * (1 + 95/100) = 100 * 1.95 = 195
      expect(result.currentStopLossPercentage).toBe(95);
      expect(result.stopLossPrice).toBe(195); // 100 * 1.95 = 195
    });

    it('should trigger trailing stop loss when price drops below trailing threshold', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: 90, // Trailing at 90% (90% gain from purchase)
        peakPrice: 200, // Peak was 200
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 179; // Below stop loss price (190)
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [{ change: 100, stopLoss: 90 }],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      expect(result.shouldTrigger).toBe(true);
      // Stop loss is calculated from purchase: 100 * (1 + 90/100) = 100 * 1.90 = 190
      expect(result.stopLossPrice).toBe(190); // 100 * 1.90 = 190
    });

    it('should use highest matching trailing level', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: -32,
        peakPrice: 100,
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 250; // 150% gain
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [
            { change: 50, stopLoss: 90 },
            { change: 100, stopLoss: 95 },
            { change: 200, stopLoss: 98 },
          ],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      // Should match the 100% level (highest that is <= 150%)
      expect(result.currentStopLossPercentage).toBe(95);
      // Stop loss is calculated from purchase: 100 * (1 + 95/100) = 100 * 1.95 = 195
      expect(result.stopLossPrice).toBe(195); // 100 * 1.95 = 195
    });

    it('should not update stop loss if it would decrease (monotonic increase)', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: 90, // Already at 90%
        peakPrice: 200,
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 150; // Price dropped, but still above stop loss
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [{ change: 50, stopLoss: 90 }],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      // Should keep 90% (not decrease to -32%)
      expect(result.currentStopLossPercentage).toBe(90);
      expect(result.updated).toBe(false); // No update since peak didn't change
    });

    it('should handle edge case: price exactly at stop loss threshold', async () => {
      // Arrange
      const position = createMockPosition({
        purchasePrice: 100,
        currentStopLossPercentage: -32,
        peakPrice: 100,
      });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 68; // Exactly at -32% threshold
      const config = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -32,
          trailingLevels: [],
          mode: 'custom' as const,
        },
      });
      
      // Act
      const result = await stopLossManager.evaluateStopLoss(position, currentPrice, config);
      
      // Assert
      expect(result.shouldTrigger).toBe(true); // <= should trigger
    });

    it('should not trigger after DCA re-initializes stop-loss with new cost basis (issue #32)', async () => {
      // Regression test: after multiple DCA buys, purchasePrice drops while peakPrice
      // stays at the original high. This creates a phantom "gain" that tightens the
      // trailing stop-loss above the current market price, causing an immediate sell.
      //
      // Scenario: 3 DCA buys at -10% each (aggressive mode, 100% buy)
      //   Original buy at P, peakPrice = P
      //   After 3 DCAs, purchasePrice ≈ 0.0805P, peakPrice still P
      //   peakChangePercent = ((P - 0.0805P) / 0.0805P) * 100 ≈ 24.2%
      //   Fixed-stepper: 24.2 >= 20 → stopLoss = max(0, 24.2-10) = 14.2%
      //   stopLossPrice = 0.0805P * 1.142 ≈ 0.092P — above market price of 0.073P!
      //
      // Fix: after DCA, initializeStopLoss resets peakPrice to new purchasePrice.

      // --- Part A: Demonstrate the bug (stale peakPrice → phantom gain → immediate trigger) ---
      const stalePosition = createMockPosition({
        purchasePrice: 0.0000805,   // New weighted avg after 3 DCAs
        currentStopLossPercentage: -50,
        peakPrice: 0.0001,          // Still at original purchase price (stale!)
      });
      mockPositionService.getPositionById.mockResolvedValue(stalePosition);
      const marketPrice = 0.000073;

      const fixedConfig = createMockConfig({
        stopLoss: {
          enabled: true,
          defaultPercentage: -50,
          trailingLevels: [],
          mode: 'fixed' as const,
        },
      });

      const bugResult = await stopLossManager.evaluateStopLoss(stalePosition, marketPrice, fixedConfig);
      // With stale peakPrice, the phantom 24% gain tightens the stop-loss and triggers
      expect(bugResult.shouldTrigger).toBe(true);

      // --- Part B: After fix (peakPrice reset to new purchasePrice via initializeStopLoss) ---
      jest.clearAllMocks();
      const { redisService } = await import('@/infrastructure/cache/redis-client.js');
      (redisService.acquireLock as jest.Mock).mockResolvedValue('mock-lock-token');
      (redisService.releaseLock as jest.Mock).mockResolvedValue(undefined);

      const fixedPosition = createMockPosition({
        purchasePrice: 0.0000805,
        currentStopLossPercentage: -50,  // Reset to default by initializeStopLoss
        peakPrice: 0.0000805,            // Reset to new purchasePrice by initializeStopLoss
      });
      mockPositionService.getPositionById.mockResolvedValue(fixedPosition);
      mockPositionService.updatePosition.mockResolvedValue(undefined);

      const fixedResult = await stopLossManager.evaluateStopLoss(fixedPosition, marketPrice, fixedConfig);
      // With reset peakPrice, stop-loss price = 0.0000805 * 0.5 = 0.00004025
      // Market price 0.000073 > 0.00004025 → no trigger
      expect(fixedResult.shouldTrigger).toBe(false);
      expect(fixedResult.stopLossPrice).toBeCloseTo(0.0000805 * 0.5, 10);
    });

    it('should load config from Redis if not provided', async () => {
      // Arrange
      const position = createMockPosition({ purchasePrice: 100 });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 80;
      
      // Act
      await stopLossManager.evaluateStopLoss(position, currentPrice);
      
      // Assert
      expect(mockRedisConfigService.getAgentConfig).toHaveBeenCalledWith(position.agentId);
    });

    it('should fallback to DB config if Redis returns null', async () => {
      // Arrange
      const position = createMockPosition({ purchasePrice: 100 });
      mockPositionService.getPositionById.mockResolvedValue(position);
      const currentPrice = 80;
      
      mockRedisConfigService.getAgentConfig.mockResolvedValue(null);
      
      // Act
      await stopLossManager.evaluateStopLoss(position, currentPrice);
      
      // Assert
      expect(mockConfigService.loadAgentConfig).toHaveBeenCalledWith(position.agentId);
    });
  });
});
