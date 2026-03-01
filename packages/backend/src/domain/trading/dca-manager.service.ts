/**
 * DCA (Dollar Cost Averaging) Manager Service
 * 
 * Manages DCA evaluation for open positions.
 * Evaluates price drops against configured DCA levels and determines
 * when to trigger additional buys.
 */

import { configService } from './config-service.js';
import { redisConfigService } from '@/infrastructure/cache/redis-config-service.js';
import { getDCALevelsForMode } from '@nexgent/shared';
import type { AgentTradingConfig, DCALevel, DCAConfig, OpenPosition } from '@nexgent/shared';
import logger from '@/infrastructure/logging/logger.js';

/**
 * Result of a DCA evaluation
 */
export interface DCAEvaluationResult {
  /** Whether DCA should be triggered */
  shouldTrigger: boolean;
  
  /** The DCA level that triggered (if any) */
  triggerLevel: DCALevel | null;
  
  /** Amount of SOL to buy (based on current position value and level buyPercent) */
  buyAmountSol: number | null;
  
  /** Human-readable reason for the evaluation result */
  reason: string;
}

/**
 * DCA Manager Service
 * 
 * Singleton service for managing DCA evaluation logic.
 */
class DCAManager {
  private static instance: DCAManager;

  private constructor() {}

  static getInstance(): DCAManager {
    if (!DCAManager.instance) {
      DCAManager.instance = new DCAManager();
    }
    return DCAManager.instance;
  }

  /**
   * Evaluate DCA for a position
   * 
   * Checks if a DCA buy should be triggered based on:
   * 1. DCA enabled in config
   * 2. Max DCA count not reached
   * 3. Cooldown period elapsed since last DCA
   * 4. Price has dropped to a DCA level
   * 
   * @param position - Open position to evaluate
   * @param currentPrice - Current token price in SOL per token
   * @param config - Trading configuration (optional, will fetch from Redis/DB if not provided)
   * @returns Evaluation result indicating whether to trigger DCA and how much
   */
  async evaluateDCA(
    position: OpenPosition,
    currentPrice: number,
    config?: AgentTradingConfig
  ): Promise<DCAEvaluationResult> {
    // Load config if not provided
    if (!config) {
      config = await redisConfigService.getAgentConfig(position.agentId) || undefined;
      if (!config) {
        config = await configService.loadAgentConfig(position.agentId);
      }
    }

    // Check if DCA is enabled
    if (!config.dca?.enabled) {
      return {
        shouldTrigger: false,
        triggerLevel: null,
        buyAmountSol: null,
        reason: 'DCA disabled',
      };
    }

    // Skip DCA when only moon bag remains
    if (position.moonBagActivated && position.moonBagAmount !== null) {
      const remaining = position.remainingAmount ?? position.purchaseAmount;
      if (Math.abs(remaining - position.moonBagAmount) < 0.000001) {
        return {
          shouldTrigger: false,
          triggerLevel: null,
          buyAmountSol: null,
          reason: 'Only moon bag remains — DCA disabled',
        };
      }
    }

    // Get DCA levels first so we know the effective cap (max DCAs = number of levels)
    const levels = this.getDCALevels(config.dca);

    if (levels.length === 0) {
      return {
        shouldTrigger: false,
        triggerLevel: null,
        buyAmountSol: null,
        reason: 'No DCA levels configured',
      };
    }

    // Cap is the number of levels — no separate maxDCACount
    if (position.dcaCount >= levels.length) {
      return {
        shouldTrigger: false,
        triggerLevel: null,
        buyAmountSol: null,
        reason: `All DCA levels used (${position.dcaCount}/${levels.length})`,
      };
    }

    // Check cooldown
    if (position.lastDcaTime) {
      const cooldownMs = config.dca.cooldownSeconds * 1000;
      const timeSinceLastDca = Date.now() - new Date(position.lastDcaTime).getTime();
      
      if (timeSinceLastDca < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastDca) / 1000);
        return {
          shouldTrigger: false,
          triggerLevel: null,
          buyAmountSol: null,
          reason: `Cooldown active (${remainingSeconds}s remaining)`,
        };
      }
    }

    // Calculate drop percentage from average purchase price
    const avgPrice = position.purchasePrice;
    const dropPercent = ((currentPrice - avgPrice) / avgPrice) * 100;

    logger.debug({
      positionId: position.id,
      agentId: position.agentId,
      tokenAddress: position.tokenAddress,
      currentPrice,
      avgPrice,
      dropPercent: dropPercent.toFixed(2),
      dcaCount: position.dcaCount,
      levelsCount: levels.length,
    }, 'DCA evaluation started');

    // Find the DCA level that should trigger
    // Levels are sorted by dropPercent (least negative to most negative)
    // We want to find the level that matches the current dcaCount
    // (i.e., if dcaCount is 0, use first level; if dcaCount is 1, use second level, etc.)
    const levelIndex = position.dcaCount;
    
    if (levelIndex >= levels.length) {
      return {
        shouldTrigger: false,
        triggerLevel: null,
        buyAmountSol: null,
        reason: `All DCA levels exhausted (${levelIndex}/${levels.length})`,
      };
    }

    const targetLevel = levels[levelIndex];

    // Check if price has dropped to this level
    if (dropPercent <= targetLevel.dropPercent) {
      // Calculate buy amount based on current remaining position value
      // Use remainingAmount (after TP sales) if set, otherwise full purchaseAmount
      const effectiveAmount = position.remainingAmount ?? position.purchaseAmount;
      const currentPositionValueSol = currentPrice * effectiveAmount;
      const buyAmountSol = (currentPositionValueSol * targetLevel.buyPercent) / 100;

      logger.info({
        positionId: position.id,
        tokenSymbol: position.tokenSymbol,
        dropPercent: dropPercent.toFixed(2),
        targetDropPercent: targetLevel.dropPercent,
        buyAmountSol: buyAmountSol.toFixed(6),
        effectiveAmount,
        currentPositionValueSol: currentPositionValueSol.toFixed(6),
        dcaCount: position.dcaCount,
        levelIndex,
      }, 'DCA level triggered (evaluation)');

      return {
        shouldTrigger: true,
        triggerLevel: targetLevel,
        buyAmountSol,
        reason: `Price dropped ${dropPercent.toFixed(2)}% (level: ${targetLevel.dropPercent}%)`,
      };
    }

    return {
      shouldTrigger: false,
      triggerLevel: null,
      buyAmountSol: null,
      reason: `Price drop ${dropPercent.toFixed(2)}% has not reached next level (${targetLevel.dropPercent}%)`,
    };
  }

  /**
   * Get DCA levels for a config
   * 
   * Returns levels from template if using a preset mode,
   * or custom levels if mode is 'custom'.
   * 
   * @param dcaConfig - DCA configuration
   * @returns Array of DCA levels sorted by dropPercent (least negative first)
   */
  private getDCALevels(dcaConfig: DCAConfig): DCALevel[] {
    if (dcaConfig.mode === 'custom') {
      // Return user-defined levels, ensure they're sorted
      return [...dcaConfig.levels].sort((a, b) => b.dropPercent - a.dropPercent);
    }
    
    // Get levels from template
    return getDCALevelsForMode(dcaConfig.mode);
  }

  /**
   * Calculate new weighted average price after a DCA buy
   * 
   * @param existingTotalSol - Total SOL invested so far
   * @param existingTokenAmount - Total tokens held
   * @param newSolSpent - SOL spent in this DCA
   * @param newTokensAcquired - Tokens acquired in this DCA
   * @returns New average price, total amount, and total invested
   */
  calculateNewAveragePrice(
    existingTotalSol: number,
    existingTokenAmount: number,
    newSolSpent: number,
    newTokensAcquired: number
  ): {
    newAveragePrice: number;
    newTotalAmount: number;
    newTotalInvested: number;
  } {
    const newTotalInvested = existingTotalSol + newSolSpent;
    const newTotalAmount = existingTokenAmount + newTokensAcquired;
    const newAveragePrice = newTotalInvested / newTotalAmount;

    logger.debug({
      existingTotalSol,
      existingTokenAmount,
      newSolSpent,
      newTokensAcquired,
      newTotalInvested,
      newTotalAmount,
      newAveragePrice,
    }, 'Calculated new average price after DCA');

    return {
      newAveragePrice,
      newTotalAmount,
      newTotalInvested,
    };
  }
}

export const dcaManager = DCAManager.getInstance();
