/**
 * Wallet Reset Service
 * 
 * Handles complete reset of wallet trading data including:
 * - Positions (DB + Redis)
 * - Historical swaps (DB)
 * - Balances (DB + Redis)
 * - Transactions (DB)
 * - Price tracking (in-memory)
 * 
 * This is a destructive operation that cannot be undone.
 */

import { prisma } from '@/infrastructure/database/client.js';
import { positionEventEmitter } from '../trading/position-events.js';
import { REDIS_KEYS } from '@/shared/constants/redis-keys.js';
import { redisService } from '@/infrastructure/cache/redis-client.js';
import { redisPositionService } from '@/infrastructure/cache/redis-position-service.js';
import logger from '@/infrastructure/logging/logger.js';

/**
 * Wallet reset result
 */
export interface WalletResetResult {
  success: boolean;
  walletAddress: string;
  agentId: string;
  deleted: {
    positions: number;
    historicalSwaps: number;
    balances: number;
    transactions: number;
    balanceSnapshots: number;
  };
  clearedCache: {
    positionKeys: number;
    balanceKeys: number;
    indexKeys: number;
  };
  duration: number;
}

/**
 * Wallet reset error
 */
export class WalletResetError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WalletResetError';
  }
}

/**
 * Wallet Reset Service
 * 
 * Provides methods for completely resetting wallet trading data.
 */
class WalletResetService {
  private static instance: WalletResetService;

  private constructor() {}

  public static getInstance(): WalletResetService {
    if (!WalletResetService.instance) {
      WalletResetService.instance = new WalletResetService();
    }
    return WalletResetService.instance;
  }

  /**
   * Reset all trading data for a wallet
   * 
   * Order of operations:
   * 1. Load data (need for Redis cleanup and events)
   * 2. Clear Redis (prevent stale cache reads)
   * 3. Emit position_closed events (triggers price tracking cleanup)
   * 4. Delete from database (atomic transaction)
   * 
   * @param walletAddress - Wallet address to reset
   * @param agentId - Agent ID (for validation and cache keys)
   * @returns Reset result with counts
   * @throws WalletResetError if reset fails
   */
  async resetWallet(walletAddress: string, agentId: string): Promise<WalletResetResult> {
    const startTime = Date.now();
    
    logger.info({ walletAddress, agentId }, 'Starting wallet reset');

    try {
      // Step 1: Load existing data (need for Redis cleanup and events)
      const [positions, balances] = await Promise.all([
        prisma.agentPosition.findMany({
          where: { walletAddress },
          select: {
            id: true,
            agentId: true,
            walletAddress: true,
            tokenAddress: true,
          },
        }),
        prisma.agentBalance.findMany({
          where: { walletAddress },
          select: {
            id: true,
            agentId: true,
            walletAddress: true,
            tokenAddress: true,
          },
        }),
      ]);

      logger.debug({
        walletAddress,
        positionsCount: positions.length,
        balancesCount: balances.length,
      }, 'Loaded existing data for reset');

      // Step 2: Clear Redis cache BEFORE database deletion
      // This prevents stale cache reads during the reset
      const cacheResult = await this.clearRedisCache(agentId, walletAddress, positions, balances);

      // Step 2b: Force-purge wallet positions from Redis indexes/payloads.
      // This handles stale Redis entries that are no longer present in DB and would
      // otherwise survive reset because we only loaded current DB positions above.
      const forceDeletedRedisPositions = await redisPositionService.deleteWalletPositions(agentId, walletAddress);

      // Step 3: Emit position_closed events for each position
      // This triggers PriceUpdateManager to remove agent from token tracking
      for (const position of positions) {
        positionEventEmitter.emitPositionClosed({
          agentId: position.agentId,
          walletAddress: position.walletAddress,
          positionId: position.id,
          tokenAddress: position.tokenAddress,
          source: 'wallet_reset',
        });
      }

      logger.debug({ positionsCount: positions.length }, 'Emitted position_closed events');

      // Step 4: Delete from database in a transaction
      const dbResult = await prisma.$transaction(async (tx) => {
        // Delete positions (must be first due to FK constraints)
        const deletedPositions = await tx.agentPosition.deleteMany({
          where: { walletAddress },
        });

        // Delete historical swaps
        const deletedSwaps = await tx.agentHistoricalSwap.deleteMany({
          where: { walletAddress },
        });

        // Delete balances
        const deletedBalances = await tx.agentBalance.deleteMany({
          where: { walletAddress },
        });

        // Delete transactions
        const deletedTransactions = await tx.agentTransaction.deleteMany({
          where: { walletAddress },
        });

        // Delete balance snapshots
        const deletedSnapshots = await tx.agentBalanceSnapshot.deleteMany({
          where: { walletAddress },
        });

        return {
          positions: deletedPositions.count,
          historicalSwaps: deletedSwaps.count,
          balances: deletedBalances.count,
          transactions: deletedTransactions.count,
          balanceSnapshots: deletedSnapshots.count,
        };
      });

      const duration = Date.now() - startTime;

      const result: WalletResetResult = {
        success: true,
        walletAddress,
        agentId,
        deleted: dbResult,
        clearedCache: cacheResult,
        duration,
      };

      logger.info({
        walletAddress,
        agentId,
        deleted: dbResult,
        clearedCache: cacheResult,
        forceDeletedRedisPositions,
        duration,
      }, 'Wallet reset completed successfully');

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error({
        walletAddress,
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      }, 'Wallet reset failed');

      if (error instanceof WalletResetError) {
        throw error;
      }

      throw new WalletResetError(
        `Failed to reset wallet: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'RESET_FAILED',
        { walletAddress, agentId }
      );
    }
  }

  /**
   * Clear Redis cache for a wallet
   * 
   * Clears:
   * - Position keys (position:{id})
   * - Agent position index (agent:{agentId}:positions)
   * - Token position indexes (token:{tokenAddress}:positions)
   * - Balance keys (balance:{agentId}:{walletAddress}:{tokenAddress})
   */
  private async clearRedisCache(
    agentId: string,
    walletAddress: string,
    positions: Array<{ id: string; tokenAddress: string }>,
    balances: Array<{ tokenAddress: string }>
  ): Promise<{ positionKeys: number; balanceKeys: number; indexKeys: number }> {
    const client = redisService.getClient();
    let positionKeysDeleted = 0;
    let balanceKeysDeleted = 0;
    let indexKeysDeleted = 0;

    // Collect unique token addresses (normalized to lowercase)
    const tokenAddresses = new Set<string>();
    for (const position of positions) {
      tokenAddresses.add(position.tokenAddress.toLowerCase());
    }

    // Delete position keys and remove from indexes
    for (const position of positions) {
      try {
        // Delete position data
        const positionKey = REDIS_KEYS.POSITION(position.id);
        await redisService.del(positionKey);
        positionKeysDeleted++;

        // Remove from agent index
        const agentKey = REDIS_KEYS.AGENT_POSITIONS(agentId);
        await client.srem(agentKey, position.id);

        // Remove from token index
        const tokenKey = REDIS_KEYS.TOKEN_POSITIONS(position.tokenAddress.toLowerCase());
        await client.srem(tokenKey, position.id);
      } catch (error) {
        logger.warn({ positionId: position.id, error }, 'Failed to delete position from Redis');
      }
    }

    // Clean up empty index sets
    try {
      const agentKey = REDIS_KEYS.AGENT_POSITIONS(agentId);
      const agentSetSize = await client.scard(agentKey);
      if (agentSetSize === 0) {
        await client.del(agentKey);
        indexKeysDeleted++;
      }
    } catch (error) {
      logger.warn({ agentId, error }, 'Failed to clean up agent position index');
    }

    // Clean up token indexes
    for (const tokenAddress of tokenAddresses) {
      try {
        const tokenKey = REDIS_KEYS.TOKEN_POSITIONS(tokenAddress);
        const tokenSetSize = await client.scard(tokenKey);
        if (tokenSetSize === 0) {
          await client.del(tokenKey);
          indexKeysDeleted++;
        }
      } catch (error) {
        logger.warn({ tokenAddress, error }, 'Failed to clean up token position index');
      }
    }

    // Delete balance keys
    for (const balance of balances) {
      try {
        const balanceKey = REDIS_KEYS.BALANCE(agentId, walletAddress, balance.tokenAddress);
        await redisService.del(balanceKey);
        balanceKeysDeleted++;
      } catch (error) {
        logger.warn({ tokenAddress: balance.tokenAddress, error }, 'Failed to delete balance from Redis');
      }
    }

    logger.debug({
      positionKeysDeleted,
      balanceKeysDeleted,
      indexKeysDeleted,
    }, 'Redis cache cleared');

    return {
      positionKeys: positionKeysDeleted,
      balanceKeys: balanceKeysDeleted,
      indexKeys: indexKeysDeleted,
    };
  }

  /**
   * Verify wallet belongs to agent and agent belongs to user
   * 
   * @param walletAddress - Wallet address to verify
   * @param userId - User ID to verify ownership
   * @returns Wallet and agent info if valid
   * @throws WalletResetError if wallet not found or not owned by user
   */
  async verifyWalletOwnership(
    walletAddress: string,
    userId: string
  ): Promise<{ walletAddress: string; agentId: string }> {
    const wallet = await prisma.agentWallet.findFirst({
      where: {
        walletAddress,
        agent: {
          userId,
        },
      },
      select: {
        walletAddress: true,
        agentId: true,
      },
    });

    if (!wallet) {
      throw new WalletResetError(
        'Wallet not found or access denied',
        'WALLET_NOT_FOUND',
        { walletAddress, userId }
      );
    }

    return {
      walletAddress: wallet.walletAddress,
      agentId: wallet.agentId,
    };
  }
}

// Export singleton instance
export const walletResetService = WalletResetService.getInstance();

// Export class for testing
export { WalletResetService };

