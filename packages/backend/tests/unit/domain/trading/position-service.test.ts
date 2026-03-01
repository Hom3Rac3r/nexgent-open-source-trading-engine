/**
 * Position Service Unit Tests
 * 
 * Tests position management logic (CRUD operations, caching, events).
 */

import { positionService, PositionServiceError } from '@/domain/trading/position-service.js';
import { Decimal } from '@prisma/client/runtime/library';

// Mock dependencies
jest.mock('@/infrastructure/cache/redis-position-service.js', () => ({
  redisPositionService: {
    getAgentPositionIds: jest.fn(),
    getTokenPositionIds: jest.fn(),
    getPosition: jest.fn(),
    setPosition: jest.fn(),
    deletePosition: jest.fn(),
  },
}));

jest.mock('@/domain/trading/position-events.js', () => ({
  positionEventEmitter: {
    emitPositionCreated: jest.fn(),
    emitPositionUpdated: jest.fn(),
    emitPositionClosed: jest.fn(),
  },
}));

const mockQueueAdd = jest.fn();
jest.mock('@/infrastructure/queue/queue-client.js', () => ({
  queueClient: {
    getQueue: jest.fn(() => ({
      add: mockQueueAdd,
    })),
  },
}));

jest.mock('@/infrastructure/database/repositories/position.repository.js', () => {
  const mockPositionRepoInstance = {
    findById: jest.fn(),
    findByAgentId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  return {
    PositionRepository: jest.fn().mockImplementation(() => mockPositionRepoInstance),
    __mockPositionRepoInstance: mockPositionRepoInstance,
  };
});

jest.mock('@/infrastructure/database/repositories/transaction.repository.js', () => {
  const mockTransactionRepoInstance = {
    findById: jest.fn(),
  };
  return {
    TransactionRepository: jest.fn().mockImplementation(() => mockTransactionRepoInstance),
    __mockTransactionRepoInstance: mockTransactionRepoInstance,
  };
});

jest.mock('@/infrastructure/database/client.js', () => ({
  prisma: {
    agentPosition: {
      findMany: jest.fn(),
    },
  },
}));

// Mock logger
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

describe('PositionService', () => {
  let mockRedisPositionService: any;
  let mockPositionEventEmitter: any;
  let mockQueueClient: any;
  let mockPrisma: any;
  let mockPositionRepoInstance: any;
  let mockTransactionRepoInstance: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Get mocked modules
    const redisModule = await import('@/infrastructure/cache/redis-position-service.js');
    mockRedisPositionService = redisModule.redisPositionService;

    const eventModule = await import('@/domain/trading/position-events.js');
    mockPositionEventEmitter = eventModule.positionEventEmitter;

    const queueModule = await import('@/infrastructure/queue/queue-client.js');
    mockQueueClient = queueModule.queueClient;

    const prismaModule = await import('@/infrastructure/database/client.js');
    mockPrisma = prismaModule.prisma;

    // Get mock repository instances
    const positionRepoModule = await import('@/infrastructure/database/repositories/position.repository.js');
    mockPositionRepoInstance = (positionRepoModule as any).__mockPositionRepoInstance;

    const transactionRepoModule = await import('@/infrastructure/database/repositories/transaction.repository.js');
    mockTransactionRepoInstance = (transactionRepoModule as any).__mockTransactionRepoInstance;
  });

  describe('loadPositions', () => {
    it('should load positions from Redis cache', async () => {
      // Arrange
      const agentId = 'agent-123';
      const walletAddress = 'wallet-123';
      const positionId = 'position-123';
      const cachedPosition = {
        id: positionId,
        agentId,
        walletAddress,
        tokenAddress: 'Token1111111111111111111111111111111111111111',
        tokenSymbol: 'TEST',
        purchaseTransactionId: 'tx-123',
        purchasePrice: 1.0,
        purchaseAmount: 1.0,
        currentStopLossPercentage: -32,
        peakPrice: 1.5,
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisPositionService.getAgentPositionIds.mockResolvedValue([positionId]);
      mockRedisPositionService.getPosition.mockResolvedValue(cachedPosition);

      // Act
      const result = await positionService.loadPositions(agentId, walletAddress);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(positionId);
      expect(result[0].walletAddress).toBe(walletAddress);
      expect(mockRedisPositionService.getAgentPositionIds).toHaveBeenCalledWith(agentId);
      expect(mockRedisPositionService.getPosition).toHaveBeenCalledWith(positionId);
    });

    it('should filter positions by walletAddress from cache', async () => {
      // Arrange
      const agentId = 'agent-123';
      const walletAddress = 'wallet-123';
      const positionId1 = 'position-1';
      const positionId2 = 'position-2';
      const cachedPosition1 = {
        id: positionId1,
        agentId,
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-1',
        purchasePrice: 1.0,
        purchaseAmount: 1.0,
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const cachedPosition2 = {
        id: positionId2,
        agentId,
        walletAddress: 'wallet-456', // Different wallet
        tokenAddress: 'Token2',
        tokenSymbol: 'T2',
        purchaseTransactionId: 'tx-2',
        purchasePrice: 2.0,
        purchaseAmount: 2.0,
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisPositionService.getAgentPositionIds.mockResolvedValue([positionId1, positionId2]);
      mockRedisPositionService.getPosition
        .mockResolvedValueOnce(cachedPosition1)
        .mockResolvedValueOnce(cachedPosition2);

      // Act
      const result = await positionService.loadPositions(agentId, walletAddress);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(positionId1);
      expect(result[0].walletAddress).toBe(walletAddress);
    });

    it('should fall back to database when cache is empty', async () => {
      // Arrange
      const agentId = 'agent-123';
      const walletAddress = 'wallet-123';
      const dbPosition = {
        id: 'position-123',
        agentId,
        walletAddress,
        tokenAddress: 'Token1111111111111111111111111111111111111111',
        tokenSymbol: 'TEST',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisPositionService.getAgentPositionIds.mockResolvedValue([]);
      mockPositionRepoInstance.findByAgentId.mockResolvedValue([dbPosition]);

      // Act
      const result = await positionService.loadPositions(agentId, walletAddress);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('position-123');
      expect(mockPositionRepoInstance.findByAgentId).toHaveBeenCalledWith(agentId);
      expect(mockRedisPositionService.setPosition).toHaveBeenCalledWith(dbPosition);
    });
  });

  describe('getPositionById', () => {
    it('should return position when found', async () => {
      // Arrange
      const positionId = 'position-123';
      const dbPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1111111111111111111111111111111111111111',
        tokenSymbol: 'TEST',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPositionRepoInstance.findById.mockResolvedValue(dbPosition);

      // Act
      const result = await positionService.getPositionById(positionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.id).toBe(positionId);
      expect(result?.purchasePrice).toBe(1.0);
    });

    it('should return null when position not found', async () => {
      // Arrange
      mockPositionRepoInstance.findById.mockResolvedValue(null);

      // Act
      const result = await positionService.getPositionById('non-existent');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getPositionsByToken', () => {
    it('should load positions from Redis cache', async () => {
      // Arrange
      const tokenAddress = 'Token1111111111111111111111111111111111111111';
      const positionId = 'position-123';
      const cachedPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol: 'TEST',
        purchaseTransactionId: 'tx-123',
        purchasePrice: 1.0,
        purchaseAmount: 1.0,
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisPositionService.getTokenPositionIds.mockResolvedValue([positionId]);
      mockRedisPositionService.getPosition.mockResolvedValue(cachedPosition);

      // Act
      const result = await positionService.getPositionsByToken(tokenAddress);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(positionId);
      expect(mockRedisPositionService.getTokenPositionIds).toHaveBeenCalledWith(tokenAddress.toLowerCase());
    });

    it('should fall back to database when cache is empty', async () => {
      // Arrange
      const tokenAddress = 'Token1111111111111111111111111111111111111111';
      const dbPosition = {
        id: 'position-123',
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: tokenAddress.toLowerCase(),
        tokenSymbol: 'TEST',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisPositionService.getTokenPositionIds.mockResolvedValue([]);
      mockPrisma.agentPosition.findMany.mockResolvedValue([dbPosition]);

      // Act
      const result = await positionService.getPositionsByToken(tokenAddress);

      // Assert
      expect(result).toHaveLength(1);
      expect(mockPrisma.agentPosition.findMany).toHaveBeenCalled();
    });
  });

  describe('getPositionByToken', () => {
    it('should return position from cache', async () => {
      // Arrange
      const agentId = 'agent-123';
      const walletAddress = 'wallet-123';
      const tokenAddress = 'Token1111111111111111111111111111111111111111';
      const positionId = 'position-123';
      const cachedPosition = {
        id: positionId,
        agentId,
        walletAddress,
        tokenAddress,
        tokenSymbol: 'TEST',
        purchaseTransactionId: 'tx-123',
        purchasePrice: 1.0,
        purchaseAmount: 1.0,
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRedisPositionService.getTokenPositionIds.mockResolvedValue([positionId]);
      mockRedisPositionService.getPosition.mockResolvedValue(cachedPosition);

      // Act
      const result = await positionService.getPositionByToken(agentId, walletAddress, tokenAddress);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.id).toBe(positionId);
      expect(result?.agentId).toBe(agentId);
      expect(result?.walletAddress).toBe(walletAddress);
    });

    it('should return null when position not found', async () => {
      // Arrange
      mockRedisPositionService.getTokenPositionIds.mockResolvedValue([]);
      mockPositionRepoInstance.findByAgentId.mockResolvedValue([]);

      // Act
      const result = await positionService.getPositionByToken('agent-123', 'wallet-123', 'Token1');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('createPosition', () => {
    it('should create position successfully', async () => {
      // Arrange
      const agentId = 'agent-123';
      const walletAddress = 'wallet-123';
      const transactionId = 'tx-123';
      const tokenAddress = 'Token1111111111111111111111111111111111111111';
      const tokenSymbol = 'TEST';
      const purchasePrice = 1.0;
      const purchaseAmount = 1.0;

      const mockTransaction = {
        id: transactionId,
        agentId,
        walletAddress,
        transactionType: 'SWAP' as const,
        outputMint: tokenAddress,
      };

      mockTransactionRepoInstance.findById.mockResolvedValue(mockTransaction);
      mockPositionRepoInstance.findByAgentId.mockResolvedValue([]); // No existing positions
      
      // Mock DB create to return a position
      const createdDbPosition = {
        id: expect.any(String),
        agentId,
        walletAddress,
        tokenAddress,
        tokenSymbol,
        purchaseTransactionId: transactionId,
        purchasePrice: new Decimal(purchasePrice),
        purchaseAmount: new Decimal(purchaseAmount),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      };
      mockPositionRepoInstance.create.mockResolvedValue(createdDbPosition);

      // Act
      const result = await positionService.createPosition(
        agentId,
        walletAddress,
        transactionId,
        tokenAddress,
        tokenSymbol,
        purchasePrice,
        purchaseAmount
      );

      // Assert - Write-Through: DB first, then Redis
      expect(mockPositionRepoInstance.create).toHaveBeenCalled();
      expect(mockRedisPositionService.setPosition).toHaveBeenCalledWith(createdDbPosition);
      expect(mockPositionEventEmitter.emitPositionCreated).toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled(); // No queue job in write-through
      
      expect(result).toBeDefined();
      expect(result.agentId).toBe(agentId);
      expect(result.walletAddress).toBe(walletAddress);
      expect(result.tokenAddress).toBe(tokenAddress);
      expect(result.purchasePrice).toBe(purchasePrice);
      expect(result.purchaseAmount).toBe(purchaseAmount);
    });

    it('should throw error when transaction not found', async () => {
      // Arrange
      mockTransactionRepoInstance.findById.mockResolvedValue(null);

      // Act & Assert (single call, two assertions)
      const p = positionService.createPosition('agent-123', 'wallet-123', 'tx-123', 'Token1', 'T1', 1.0, 1.0);
      await expect(p).rejects.toThrow(PositionServiceError);
      await expect(p).rejects.toThrow('Transaction not found');
    });

    it('should throw error when transaction belongs to different agent/wallet', async () => {
      // Arrange
      const mockTransaction = {
        id: 'tx-123',
        agentId: 'agent-456', // Different agent
        walletAddress: 'wallet-123',
        transactionType: 'SWAP' as const,
        outputMint: 'Token1',
      };

      mockTransactionRepoInstance.findById.mockResolvedValue(mockTransaction);

      // Act & Assert (single call, two assertions)
      const p = positionService.createPosition('agent-123', 'wallet-123', 'tx-123', 'Token1', 'T1', 1.0, 1.0);
      await expect(p).rejects.toThrow(PositionServiceError);
      await expect(p).rejects.toThrow('Transaction does not belong to specified agent/wallet');
    });

    it('should throw error when transaction is not a SWAP', async () => {
      // Arrange
      const mockTransaction = {
        id: 'tx-123',
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        transactionType: 'DEPOSIT' as const, // Not SWAP
        outputMint: null,
      };

      mockTransactionRepoInstance.findById.mockResolvedValue(mockTransaction);

      // Act & Assert (single call, two assertions)
      const p = positionService.createPosition('agent-123', 'wallet-123', 'tx-123', 'Token1', 'T1', 1.0, 1.0);
      await expect(p).rejects.toThrow(PositionServiceError);
      await expect(p).rejects.toThrow('Transaction must be a SWAP');
    });

    it('should throw error when position already exists', async () => {
      // Arrange
      const agentId = 'agent-123';
      const walletAddress = 'wallet-123';
      const tokenAddress = 'Token1';
      const mockTransaction = {
        id: 'tx-123',
        agentId,
        walletAddress,
        transactionType: 'SWAP' as const,
        outputMint: tokenAddress,
      };

      const existingPosition = {
        id: 'position-123',
        agentId,
        walletAddress,
        tokenAddress,
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-456',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockTransactionRepoInstance.findById.mockResolvedValue(mockTransaction);
      mockPositionRepoInstance.findByAgentId.mockResolvedValue([existingPosition]);

      // Act & Assert (single call, two assertions)
      const p = positionService.createPosition(agentId, walletAddress, 'tx-123', tokenAddress, 'T1', 1.0, 1.0);
      await expect(p).rejects.toThrow(PositionServiceError);
      await expect(p).rejects.toThrow('Position already exists');
    });
  });

  describe('updatePosition', () => {
    it('should update position successfully', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updates = {
        currentStopLossPercentage: -32,
        peakPrice: 1.5,
        lastStopLossUpdate: new Date(),
      };

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);
      
      // Mock DB update to return updated position
      const updatedDbPosition = {
        ...existingPosition,
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(1.5),
        lastStopLossUpdate: updates.lastStopLossUpdate,
        updatedAt: expect.any(Date),
      };
      mockPositionRepoInstance.update.mockResolvedValue(updatedDbPosition);

      // Act
      const result = await positionService.updatePosition(positionId, updates);

      // Assert - Write-Through: DB first, then Redis
      expect(mockPositionRepoInstance.update).toHaveBeenCalledWith(
        positionId,
        expect.objectContaining({
          currentStopLossPercentage: expect.any(Decimal),
          peakPrice: expect.any(Decimal),
          lastStopLossUpdate: updates.lastStopLossUpdate,
        })
      );
      expect(mockRedisPositionService.setPosition).toHaveBeenCalledWith(updatedDbPosition);
      expect(mockPositionEventEmitter.emitPositionUpdated).toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled(); // No queue job in write-through
      
      expect(result).toBeDefined();
      expect(result.currentStopLossPercentage).toBe(-32);
      expect(result.peakPrice).toBe(1.5);
    });

    it('should throw error when position not found', async () => {
      // Arrange
      mockRedisPositionService.getPosition.mockResolvedValue(null);
      mockPositionRepoInstance.findById.mockResolvedValue(null);

      // Act & Assert (single call, two assertions)
      const p = positionService.updatePosition('non-existent', { currentStopLossPercentage: -32 });
      await expect(p).rejects.toThrow(PositionServiceError);
      await expect(p).rejects.toThrow('Position not found');
    });

    it('should handle null values in updates', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(1.5),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updates = {
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
      };

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);
      
      // Mock DB update to return updated position
      const updatedDbPosition = {
        ...existingPosition,
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        updatedAt: expect.any(Date),
      };
      mockPositionRepoInstance.update.mockResolvedValue(updatedDbPosition);

      // Act
      const result = await positionService.updatePosition(positionId, updates);

      // Assert - Write-Through: DB first, then Redis
      expect(mockPositionRepoInstance.update).toHaveBeenCalled();
      expect(mockRedisPositionService.setPosition).toHaveBeenCalled();
      expect(mockQueueAdd).not.toHaveBeenCalled(); // No queue job in write-through
      
      expect(result.currentStopLossPercentage).toBeNull();
      expect(result.peakPrice).toBeNull();
      expect(result.lastStopLossUpdate).toBeNull();
    });
  });

  describe('closePosition', () => {
    it('should close position successfully', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1111111111111111111111111111111111111111',
        tokenSymbol: 'TEST',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);
      mockPositionRepoInstance.delete.mockResolvedValue(undefined);

      // Act
      await positionService.closePosition(positionId);

      // Assert - Write-Through: DB first, then Redis
      expect(mockPositionRepoInstance.delete).toHaveBeenCalledWith(positionId);
      expect(mockRedisPositionService.deletePosition).toHaveBeenCalledWith(existingPosition);
      expect(mockPositionEventEmitter.emitPositionClosed).toHaveBeenCalledWith({
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        positionId,
        tokenAddress: 'Token1111111111111111111111111111111111111111',
        tokenSymbol: 'TEST',
      });
      expect(mockQueueAdd).not.toHaveBeenCalled(); // No queue job in write-through
    });

    it('should throw error when position not found', async () => {
      // Arrange
      mockPositionRepoInstance.findById.mockResolvedValue(null);

      // Act & Assert (single call, two assertions)
      const p = positionService.closePosition('non-existent');
      await expect(p).rejects.toThrow(PositionServiceError);
      await expect(p).rejects.toThrow('Position not found');
    });
  });

  describe('convertToOpenPosition', () => {
    it('should convert Decimal values to numbers', () => {
      // Arrange
      const position = {
        id: 'position-123',
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.5),
        purchaseAmount: new Decimal(2.0),
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(1.8),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      const result = (positionService as any).convertToOpenPosition(position);

      // Assert
      expect(result.purchasePrice).toBe(1.5);
      expect(result.purchaseAmount).toBe(2.0);
      expect(result.currentStopLossPercentage).toBe(-32);
      expect(result.peakPrice).toBe(1.8);
    });

    it('should handle plain number values', () => {
      // Arrange
      const position = {
        id: 'position-123',
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: 1.5,
        purchaseAmount: 2.0,
        currentStopLossPercentage: -32,
        peakPrice: 1.8,
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      const result = (positionService as any).convertToOpenPosition(position);

      // Assert
      expect(result.purchasePrice).toBe(1.5);
      expect(result.purchaseAmount).toBe(2.0);
      expect(result.currentStopLossPercentage).toBe(-32);
      expect(result.peakPrice).toBe(1.8);
    });

    it('should handle null values', () => {
      // Arrange
      const position = {
        id: 'position-123',
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      const result = (positionService as any).convertToOpenPosition(position);

      // Assert
      expect(result.currentStopLossPercentage).toBeNull();
      expect(result.peakPrice).toBeNull();
      expect(result.lastStopLossUpdate).toBeNull();
    });

    it('should convert DCA fields correctly', () => {
      // Arrange
      const position = {
        id: 'position-123',
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(0.001),
        purchaseAmount: new Decimal(1500),
        totalInvestedSol: new Decimal(1.5),
        dcaCount: 1,
        lastDcaTime: new Date('2024-01-01T12:00:00Z'),
        lowestPrice: new Decimal(0.0008),
        dcaTransactionIds: ['dca-tx-1'],
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(0.0012),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      const result = (positionService as any).convertToOpenPosition(position);

      // Assert
      expect(result.purchasePrice).toBe(0.001);
      expect(result.purchaseAmount).toBe(1500);
      expect(result.totalInvestedSol).toBe(1.5);
      expect(result.dcaCount).toBe(1);
      expect(result.lastDcaTime).toEqual(new Date('2024-01-01T12:00:00Z'));
      expect(result.lowestPrice).toBe(0.0008);
      expect(result.dcaTransactionIds).toEqual(['dca-tx-1']);
    });

    it('should handle null DCA fields', () => {
      // Arrange
      const position = {
        id: 'position-123',
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(1.0),
        purchaseAmount: new Decimal(1.0),
        totalInvestedSol: new Decimal(1.0),
        dcaCount: 0,
        lastDcaTime: null,
        lowestPrice: null,
        dcaTransactionIds: [],
        currentStopLossPercentage: null,
        peakPrice: null,
        lastStopLossUpdate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Act
      const result = (positionService as any).convertToOpenPosition(position);

      // Assert
      expect(result.dcaCount).toBe(0);
      expect(result.lastDcaTime).toBeNull();
      expect(result.lowestPrice).toBeNull();
      expect(result.dcaTransactionIds).toEqual([]);
    });
  });

  describe('updatePositionAfterDCA', () => {
    it('should update position with new average price after DCA', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(0.001),
        purchaseAmount: new Decimal(1000),
        totalInvestedSol: new Decimal(1.0),
        dcaCount: 0,
        lastDcaTime: null,
        lowestPrice: new Decimal(0.001),
        dcaTransactionIds: [],
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(0.001),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const dcaUpdate = {
        newAveragePurchasePrice: 0.0009375,
        newTotalPurchaseAmount: 1600,
        newTotalInvestedSol: 1.5,
        dcaTransactionId: 'dca-tx-123',
        newTokensAcquired: 600,
        configTpLevelsCount: 4,
      };

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);
      
      // Mock DB update to return updated position
      const updatedDbPosition = {
        ...existingPosition,
        purchasePrice: new Decimal(dcaUpdate.newAveragePurchasePrice),
        purchaseAmount: new Decimal(dcaUpdate.newTotalPurchaseAmount),
        totalInvestedSol: new Decimal(dcaUpdate.newTotalInvestedSol),
        dcaCount: 1,
        lastDcaTime: expect.any(Date),
        dcaTransactionIds: ['dca-tx-123'],
        tpBatchStartLevel: 0,
        totalTakeProfitLevels: 4,
        updatedAt: expect.any(Date),
      };
      mockPositionRepoInstance.update.mockResolvedValue(updatedDbPosition);

      // Act
      const result = await positionService.updatePositionAfterDCA(positionId, dcaUpdate);

      // Assert
      expect(mockPositionRepoInstance.update).toHaveBeenCalledWith(
        positionId,
        expect.objectContaining({
          purchasePrice: expect.any(Decimal),
          purchaseAmount: expect.any(Decimal),
          totalInvestedSol: expect.any(Decimal),
          dcaCount: 1,
          lastDcaTime: expect.any(Date),
          dcaTransactionIds: ['dca-tx-123'],
          tpBatchStartLevel: 0,
          totalTakeProfitLevels: 4,
        })
      );
      expect(mockRedisPositionService.setPosition).toHaveBeenCalledWith(updatedDbPosition);
      expect(result.purchasePrice).toBeCloseTo(0.0009375, 9);
      expect(result.purchaseAmount).toBe(1600);
      expect(result.dcaCount).toBe(1);
    });

    it('should increment DCA count correctly', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(0.0009),
        purchaseAmount: new Decimal(1800),
        totalInvestedSol: new Decimal(1.62),
        dcaCount: 1, // Already did one DCA
        lastDcaTime: new Date('2024-01-01'),
        lowestPrice: new Decimal(0.0008),
        dcaTransactionIds: ['dca-tx-1'],
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(0.001),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const dcaUpdate = {
        newAveragePurchasePrice: 0.00085,
        newTotalPurchaseAmount: 2500,
        newTotalInvestedSol: 2.125,
        dcaTransactionId: 'dca-tx-2',
        newTokensAcquired: 700,
        configTpLevelsCount: 4,
      };

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);
      
      const updatedDbPosition = {
        ...existingPosition,
        purchasePrice: new Decimal(dcaUpdate.newAveragePurchasePrice),
        purchaseAmount: new Decimal(dcaUpdate.newTotalPurchaseAmount),
        totalInvestedSol: new Decimal(dcaUpdate.newTotalInvestedSol),
        dcaCount: 2, // Incremented
        lastDcaTime: expect.any(Date),
        dcaTransactionIds: ['dca-tx-1', 'dca-tx-2'], // Appended
        updatedAt: expect.any(Date),
      };
      mockPositionRepoInstance.update.mockResolvedValue(updatedDbPosition);

      // Act
      const result = await positionService.updatePositionAfterDCA(positionId, dcaUpdate);

      // Assert
      expect(result.dcaCount).toBe(2);
      expect(result.dcaTransactionIds).toContain('dca-tx-1');
      expect(result.dcaTransactionIds).toContain('dca-tx-2');
    });

    it('should throw error when position not found', async () => {
      // Arrange
      mockPositionRepoInstance.findById.mockResolvedValue(null);

      const dcaUpdate = {
        newAveragePurchasePrice: 0.0009,
        newTotalPurchaseAmount: 1600,
        newTotalInvestedSol: 1.5,
        dcaTransactionId: 'dca-tx-123',
        newTokensAcquired: 600,
        configTpLevelsCount: 4,
      };

      // Act & Assert (single call, two assertions)
      const p = positionService.updatePositionAfterDCA('non-existent', dcaUpdate);
      await expect(p).rejects.toThrow(PositionServiceError);
      await expect(p).rejects.toThrow('Position not found');
    });
  });

  describe('updateLowestPrice', () => {
    it('should update lowest price when new price is lower', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(0.001),
        purchaseAmount: new Decimal(1000),
        totalInvestedSol: new Decimal(1.0),
        dcaCount: 0,
        lastDcaTime: null,
        lowestPrice: new Decimal(0.001),
        dcaTransactionIds: [],
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(0.001),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newLowestPrice = 0.0008;

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);
      
      const updatedDbPosition = {
        ...existingPosition,
        lowestPrice: new Decimal(newLowestPrice),
        updatedAt: expect.any(Date),
      };
      mockPositionRepoInstance.update.mockResolvedValue(updatedDbPosition);

      // Act
      await positionService.updateLowestPrice(positionId, newLowestPrice);

      // Assert
      expect(mockPositionRepoInstance.update).toHaveBeenCalledWith(
        positionId,
        expect.objectContaining({
          lowestPrice: expect.any(Decimal),
        })
      );
      expect(mockRedisPositionService.setPosition).toHaveBeenCalledWith(updatedDbPosition);
    });

    it('should not update if current price is not lower', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(0.001),
        purchaseAmount: new Decimal(1000),
        totalInvestedSol: new Decimal(1.0),
        dcaCount: 0,
        lastDcaTime: null,
        lowestPrice: new Decimal(0.0005), // Already very low
        dcaTransactionIds: [],
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(0.001),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newPrice = 0.0008; // Higher than existing lowest

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);

      // Act
      await positionService.updateLowestPrice(positionId, newPrice);

      // Assert
      // Should not call update if price is not lower
      expect(mockPositionRepoInstance.update).not.toHaveBeenCalled();
    });

    it('should update if lowestPrice is null (first update)', async () => {
      // Arrange
      const positionId = 'position-123';
      const existingPosition = {
        id: positionId,
        agentId: 'agent-123',
        walletAddress: 'wallet-123',
        tokenAddress: 'Token1',
        tokenSymbol: 'T1',
        purchaseTransactionId: 'tx-123',
        purchasePrice: new Decimal(0.001),
        purchaseAmount: new Decimal(1000),
        totalInvestedSol: new Decimal(1.0),
        dcaCount: 0,
        lastDcaTime: null,
        lowestPrice: null, // Not set
        dcaTransactionIds: [],
        currentStopLossPercentage: new Decimal(-32),
        peakPrice: new Decimal(0.001),
        lastStopLossUpdate: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const newLowestPrice = 0.0009;

      mockPositionRepoInstance.findById.mockResolvedValue(existingPosition);
      
      const updatedDbPosition = {
        ...existingPosition,
        lowestPrice: new Decimal(newLowestPrice),
        updatedAt: expect.any(Date),
      };
      mockPositionRepoInstance.update.mockResolvedValue(updatedDbPosition);

      // Act
      await positionService.updateLowestPrice(positionId, newLowestPrice);

      // Assert
      expect(mockPositionRepoInstance.update).toHaveBeenCalled();
    });

    it('should silently return when position not found', async () => {
      // Arrange
      mockPositionRepoInstance.findById.mockResolvedValue(null);

      // Act - should not throw
      await positionService.updateLowestPrice('non-existent', 0.0008);

      // Assert
      expect(mockPositionRepoInstance.update).not.toHaveBeenCalled();
    });
  });
});

