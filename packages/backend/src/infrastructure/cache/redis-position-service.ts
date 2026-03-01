/**
 * Redis Position Service
 * 
 * Handles caching of position data in Redis for high-performance access.
 * Implements read-through and write-through caching patterns.
 * Serializes Prisma Decimal fields as numbers so they round-trip correctly.
 */

import { redisService } from './redis-client.js';
import { REDIS_KEYS } from '@/shared/constants/redis-keys.js';
import logger from '@/infrastructure/logging/logger.js';
import type { AgentPosition } from '@prisma/client';

/** Convert a value (e.g. Prisma Decimal) to a JSON-safe number for Redis storage */
function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  const obj = value as Record<string, unknown>;
  if (typeof value === 'object' && value !== null) {
    if (typeof obj.toNumber === 'function') return (obj as { toNumber: () => number }).toNumber();
    if (typeof obj.toString === 'function') {
      const n = parseFloat(String(obj.toString()));
      return Number.isNaN(n) ? null : n;
    }
  }
  return null;
}

/** Serialize position for Redis so Decimal and Date fields round-trip correctly (fixes portfolio balance with take-profit) */
function serializePositionForRedis(position: AgentPosition): Record<string, unknown> {
  const p = position as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(p)) {
    const v = p[key];
    if (v instanceof Date) {
      out[key] = v.toISOString();
    } else if (v !== null && typeof v === 'object' && (typeof (v as Record<string, unknown>).toNumber === 'function' || typeof (v as Record<string, unknown>).toString === 'function')) {
      const n = decimalToNumber(v);
      out[key] = n !== null ? n : v;
    } else {
      out[key] = v;
    }
  }
  return out;
}

export class RedisPositionService {
  private static instance: RedisPositionService;

  private constructor() {}

  public static getInstance(): RedisPositionService {
    if (!RedisPositionService.instance) {
      RedisPositionService.instance = new RedisPositionService();
    }
    return RedisPositionService.instance;
  }

  /**
   * Get position from cache
   */
  public async getPosition(id: string): Promise<AgentPosition | null> {
    const key = REDIS_KEYS.POSITION(id);
    const data = await redisService.get(key);
    
    if (!data) return null;
    
    try {
      // Parse dates back to Date objects
      const position = JSON.parse(data);
      return {
        ...position,
        createdAt: new Date(position.createdAt),
        updatedAt: new Date(position.updatedAt),
        purchaseTime: position.purchaseTime ? new Date(position.purchaseTime) : null,
        lastStopLossUpdate: position.lastStopLossUpdate ? new Date(position.lastStopLossUpdate) : null,
        // DCA date field
        lastDcaTime: position.lastDcaTime ? new Date(position.lastDcaTime) : null,
        // Take-profit date field
        lastTakeProfitTime: position.lastTakeProfitTime ? new Date(position.lastTakeProfitTime) : null,
      };
    } catch (error) {
      logger.error({ positionId: id, error: error instanceof Error ? error.message : String(error) }, 'Failed to parse cached position');
      return null;
    }
  }

  /**
   * Cache position
   * No TTL - positions are invalidated explicitly via write-through pattern.
   * Serializes Decimal fields as numbers so they round-trip correctly (fixes portfolio balance with take-profit).
   */
  public async setPosition(position: AgentPosition): Promise<void> {
    const key = REDIS_KEYS.POSITION(position.id);
    const serialized = serializePositionForRedis(position);
    await redisService.set(key, JSON.stringify(serialized)); // No TTL - invalidated explicitly

    // Update indexes
    await this.addToIndexes(position);
  }

  /**
   * Remove position from cache
   */
  public async deletePosition(position: { id: string; agentId: string; tokenAddress: string }): Promise<void> {
    const key = REDIS_KEYS.POSITION(position.id);
    await redisService.del(key);
    
    // Remove from indexes
    await this.removeFromIndexes(position);
  }

  /**
   * Add position to agent and token indexes
   * Only logs when position is actually added (not already in set)
   */
  private async addToIndexes(position: AgentPosition): Promise<void> {
    const agentKey = REDIS_KEYS.AGENT_POSITIONS(position.agentId);
    // Normalize token address to lowercase for consistent indexing
    const tokenKey = REDIS_KEYS.TOKEN_POSITIONS(position.tokenAddress.toLowerCase());
    
    const client = redisService.getClient();
    
    // Use set operations for indexes
    // SADD returns 1 if element was added, 0 if it already existed
    const agentAdded = await client.sadd(agentKey, position.id);
    const tokenAdded = await client.sadd(tokenKey, position.id);
    
    // Only log if position was actually added to at least one index
    // This prevents log spam when position is updated but already indexed
    if (agentAdded > 0 || tokenAdded > 0) {
      logger.debug({ positionId: position.id, agentId: position.agentId, tokenAddress: position.tokenAddress.toLowerCase() }, 'Added position to Redis indexes');
    }
  }

  /**
   * Remove position from indexes
   */
  private async removeFromIndexes(position: { id: string; agentId: string; tokenAddress: string }): Promise<void> {
    const agentKey = REDIS_KEYS.AGENT_POSITIONS(position.agentId);
    // Normalize token address to lowercase for consistent indexing
    const tokenKey = REDIS_KEYS.TOKEN_POSITIONS(position.tokenAddress.toLowerCase());
    
    const client = redisService.getClient();
    
    await client.srem(agentKey, position.id);
    await client.srem(tokenKey, position.id);
    
    // Clean up empty sets to prevent accumulation of stale index keys
    const agentSetSize = await client.scard(agentKey);
    if (agentSetSize === 0) {
      await client.del(agentKey);
    }
    
    const tokenSetSize = await client.scard(tokenKey);
    if (tokenSetSize === 0) {
      await client.del(tokenKey);
    }
  }

  /**
   * Get all position IDs for an agent
   */
  public async getAgentPositionIds(agentId: string): Promise<string[]> {
    const key = REDIS_KEYS.AGENT_POSITIONS(agentId);
    const client = redisService.getClient();
    return await client.smembers(key);
  }

  /**
   * Get all position IDs for a token
   */
  public async getTokenPositionIds(tokenAddress: string): Promise<string[]> {
    // Normalize token address to lowercase for consistent lookups
    const normalizedAddress = tokenAddress.toLowerCase();
    const key = REDIS_KEYS.TOKEN_POSITIONS(normalizedAddress);
    const client = redisService.getClient();
    return await client.smembers(key);
  }

  /**
   * Delete all positions for an agent
   * 
   * Removes all position cache entries and indexes for the specified agent.
   * Used when an agent is deleted.
   * 
   * @param agentId - Agent ID
   */
  public async deleteAgentPositions(agentId: string): Promise<void> {
    // Get all position IDs for this agent
    const positionIds = await this.getAgentPositionIds(agentId);
    
    if (positionIds.length === 0) {
      return; // No positions to delete
    }

    const client = redisService.getClient();
    const agentKey = REDIS_KEYS.AGENT_POSITIONS(agentId);

    // Delete each position and remove from indexes
    for (const positionId of positionIds) {
      const positionKey = REDIS_KEYS.POSITION(positionId);
      
      // Get position to find token address for index cleanup
      const positionData = await redisService.get(positionKey);
      if (positionData) {
        try {
          const position = JSON.parse(positionData);
          // Remove from token index
          const tokenKey = REDIS_KEYS.TOKEN_POSITIONS(position.tokenAddress.toLowerCase());
          await client.srem(tokenKey, positionId);
          
          // Clean up empty token set
          const tokenSetSize = await client.scard(tokenKey);
          if (tokenSetSize === 0) {
            await client.del(tokenKey);
          }
        } catch (error) {
          logger.error({ positionId, agentId, error: error instanceof Error ? error.message : String(error) }, 'Failed to parse position during cleanup');
        }
      }
      
      // Delete position cache entry
      await redisService.del(positionKey);
    }

    // Delete agent index
    await client.del(agentKey);
    
    logger.info({ agentId, deletedCount: positionIds.length }, 'Deleted agent positions from Redis');
  }

  /**
   * Delete all cached positions for a specific wallet under an agent.
   *
   * This method is resilient to stale Redis state:
   * - Removes index entries that reference missing position payloads
   * - Removes malformed position payloads
   * - Removes all positions whose walletAddress matches the target wallet
   *
   * @param agentId - Agent ID
   * @param walletAddress - Wallet address to purge
   * @returns Number of removed position payload keys
   */
  public async deleteWalletPositions(agentId: string, walletAddress: string): Promise<number> {
    const client = redisService.getClient();
    const agentKey = REDIS_KEYS.AGENT_POSITIONS(agentId);
    const positionIds = await client.smembers(agentKey);
    let deletedCount = 0;

    for (const positionId of positionIds) {
      const positionKey = REDIS_KEYS.POSITION(positionId);
      const positionData = await redisService.get(positionKey);

      // Stale agent index entry (position payload missing) - remove from index.
      if (!positionData) {
        await client.srem(agentKey, positionId);
        continue;
      }

      try {
        const position = JSON.parse(positionData) as { walletAddress?: string; tokenAddress?: string };

        if (position.walletAddress !== walletAddress) {
          continue;
        }

        // Delete payload and unlink from both indexes.
        await redisService.del(positionKey);
        await client.srem(agentKey, positionId);

        if (position.tokenAddress) {
          const tokenKey = REDIS_KEYS.TOKEN_POSITIONS(String(position.tokenAddress).toLowerCase());
          await client.srem(tokenKey, positionId);
          const tokenSetSize = await client.scard(tokenKey);
          if (tokenSetSize === 0) {
            await client.del(tokenKey);
          }
        }

        deletedCount++;
      } catch {
        // Malformed payload: delete payload and drop index reference.
        await redisService.del(positionKey);
        await client.srem(agentKey, positionId);
        deletedCount++;
      }
    }

    const agentSetSize = await client.scard(agentKey);
    if (agentSetSize === 0) {
      await client.del(agentKey);
    }

    return deletedCount;
  }
}

export const redisPositionService = RedisPositionService.getInstance();

