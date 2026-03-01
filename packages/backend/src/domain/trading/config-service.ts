/**
 * Trading Configuration Service
 * 
 * Handles loading, merging, and validating agent trading configurations.
 * Uses cache for performance and applies defaults when config is missing.
 */

import { prisma } from '@/infrastructure/database/client.js';
import { redisConfigService } from '@/infrastructure/cache/redis-config-service.js';
import { DEFAULT_TRADING_CONFIG } from '@nexgent/shared';
import {
  agentTradingConfigSchema,
  validateTradingConfigBusinessLogic,
  type AgentTradingConfig,
} from '@nexgent/shared';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/**
 * Configuration service error
 */
export class ConfigServiceError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ConfigServiceError';
  }
}

/**
 * Configuration Service
 * 
 * Singleton service for managing agent trading configurations.
 */
class ConfigService {
  /**
   * Load agent trading configuration
   * 
   * Checks cache first, then database. Merges with defaults and validates.
   * 
   * @param agentId - Agent ID
   * @returns Complete trading configuration (merged with defaults)
   * @throws ConfigServiceError if agent not found or config is invalid
   */
  async loadAgentConfig(agentId: string): Promise<AgentTradingConfig> {
    // Check cache first
    const cached = await redisConfigService.getAgentConfig(agentId);
    if (cached) {
      return cached;
    }

    // Load from database
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { tradingConfig: true },
    });

    if (!agent) {
      throw new ConfigServiceError(
        `Agent not found: ${agentId}`,
        'AGENT_NOT_FOUND'
      );
    }

    // Merge with defaults (agent.tradingConfig can be null)
    const config = this.mergeWithDefaults(agent.tradingConfig);

    // Validate configuration
    const validationResult = this.validateConfig(config);
    if (!validationResult.valid) {
      throw new ConfigServiceError(
        'Invalid trading configuration',
        'INVALID_CONFIG',
        { errors: validationResult.errors }
      );
    }

    // Cache it
    await redisConfigService.setAgentConfig(agentId, config);

    return config;
  }

  /**
   * Merge partial configuration with defaults
   * 
   * Performs deep merge of partial config with default configuration.
   * Handles migration of old signal config format to new format.
   * Normalizes mode field and removes continuousTrailing if present.
   * 
   * @param partialConfig - Partial configuration from database (can be null)
   * @returns Complete configuration with defaults applied and normalized
   */
  mergeWithDefaults(partialConfig: unknown): AgentTradingConfig {
    // If no config exists, return defaults
    if (!partialConfig || typeof partialConfig !== 'object') {
      return JSON.parse(JSON.stringify(DEFAULT_TRADING_CONFIG));
    }

    // Deep merge partial config with defaults
    const merged = this.deepMerge(
      JSON.parse(JSON.stringify(DEFAULT_TRADING_CONFIG)),
      partialConfig as Record<string, unknown>
    ) as unknown as AgentTradingConfig;

    // Normalize stop loss configuration
    if (merged.stopLoss) {
      // Ensure mode is set (default to 'fixed' if missing - pre-launch, no backward compatibility needed)
      if (!merged.stopLoss.mode) {
        merged.stopLoss.mode = 'fixed';
      }

      // Remove continuousTrailing if present (no longer used)
      if ('continuousTrailing' in merged.stopLoss) {
        delete (merged.stopLoss as Record<string, unknown>).continuousTrailing;
      }
    }

    // Normalize auto-trade token list (including per-token market-cap bounds)
    if (merged.autoTrade) {
      const rawAutoTrade = merged.autoTrade as unknown as {
        enabled?: boolean;
        tokens?: Array<{
          address?: string;
          symbol?: string;
          logoUrl?: string;
          enabled?: boolean;
          marketCapMin?: number | null;
          marketCapMax?: number | null;
        }>;
      };

      let normalizedTokens: Array<{
        address: string;
        symbol?: string;
        logoUrl?: string;
        enabled: boolean;
        marketCapMin?: number;
        marketCapMax?: number;
      }> = [];

      if (Array.isArray(rawAutoTrade.tokens)) {
        normalizedTokens = rawAutoTrade.tokens.flatMap((token) => {
          if (!token || typeof token.address !== 'string') return [];
          const rawSymbol = token.symbol;
          const symbol = typeof rawSymbol === 'string' ? rawSymbol.trim() : undefined;
          const rawLogoUrl = token.logoUrl;
          const logoUrl = typeof rawLogoUrl === 'string' ? rawLogoUrl.trim() : undefined;
          return [{
            address: token.address.trim(),
            symbol: symbol && symbol.length > 0 ? symbol : undefined,
            logoUrl: logoUrl && logoUrl.length > 0 ? logoUrl : undefined,
            enabled: token.enabled === true,
            marketCapMin: token.marketCapMin ?? undefined,
            marketCapMax: token.marketCapMax ?? undefined,
          }];
        });
      }

      merged.autoTrade = {
        enabled: rawAutoTrade.enabled ?? false,
        tokens: normalizedTokens,
      };
    }

    // Type assertion is safe here because we validate after merging
    return merged;
  }

  /** Optional signal metric keys; null in payload means "clear" (backend normalizes to undefined for validation). */
  private static readonly OPTIONAL_SIGNAL_METRIC_KEYS = [
    'marketCapMin', 'marketCapMax', 'liquidityMin', 'liquidityMax', 'holderCountMin', 'holderCountMax',
  ] as const;
  /** Optional per-token auto-trade metric keys; null in payload means "clear" (normalize to undefined for validation). */
  private static readonly OPTIONAL_AUTO_TRADE_TOKEN_METRIC_KEYS = [
    'marketCapMin', 'marketCapMax',
  ] as const;

  /**
   * Merge partial config with existing config
   * 
   * Performs deep merge of partial update into existing configuration.
   * Useful for partial updates where you want to preserve existing values.
   * Explicit null in partialConfig for optional signal metrics means "clear" (no bound).
   * 
   * @param existingConfig - Existing complete configuration
   * @param partialConfig - Partial configuration to merge in
   * @returns Merged configuration
   */
  mergeConfigs(existingConfig: AgentTradingConfig, partialConfig: Partial<AgentTradingConfig>): AgentTradingConfig {
    const merged = this.deepMerge(
      existingConfig as unknown as Record<string, unknown>,
      partialConfig as Record<string, unknown>
    ) as unknown as AgentTradingConfig;
    this.normalizeOptionalSignalMetrics(merged);
    this.normalizeOptionalAutoTradeMetrics(merged);
    return merged;
  }

  /**
   * Normalize optional signal metric fields: null → undefined so Zod optional() validation passes.
   */
  private normalizeOptionalSignalMetrics(config: AgentTradingConfig): void {
    if (!config.signals) return;
    const signals = config.signals as unknown as Record<string, unknown>;
    for (const key of ConfigService.OPTIONAL_SIGNAL_METRIC_KEYS) {
      if (signals[key] === null) {
        signals[key] = undefined;
      }
    }
  }

  /**
   * Normalize optional per-token auto-trade metric fields: null → undefined so Zod optional() validation passes.
   */
  private normalizeOptionalAutoTradeMetrics(config: AgentTradingConfig): void {
    if (!config.autoTrade?.tokens) return;
    for (const token of config.autoTrade.tokens) {
      const raw = token as unknown as Record<string, unknown>;
      for (const key of ConfigService.OPTIONAL_AUTO_TRADE_TOKEN_METRIC_KEYS) {
        if (raw[key] === null) {
          raw[key] = undefined;
        }
      }
    }
  }

  /**
   * Deep merge two objects
   * 
   * Recursively merges two objects, with the second object taking precedence
   * for conflicts. Arrays are replaced (not merged).
   * 
   * @param target - Target object (existing config)
   * @param source - Source object (partial update)
   * @returns Merged object
   */
  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };

    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = target[key];

        // If both are objects (and not arrays), merge recursively
        if (
          sourceValue &&
          typeof sourceValue === 'object' &&
          !Array.isArray(sourceValue) &&
          targetValue &&
          typeof targetValue === 'object' &&
          !Array.isArray(targetValue)
        ) {
          result[key] = this.deepMerge(
            targetValue as Record<string, unknown>,
            sourceValue as Record<string, unknown>
          );
        } else {
          // Otherwise, source takes precedence (replaces target)
          result[key] = sourceValue;
        }
      }
    }

    return result;
  }

  /**
   * Validate trading configuration
   * 
   * Validates using Zod schema and business logic rules.
   * 
   * @param config - Configuration to validate
   * @returns Validation result with errors if invalid
   */
  validateConfig(config: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate with Zod schema
    try {
      agentTradingConfigSchema.parse(config);
    } catch (error) {
      // Handle Zod errors properly
      if (error instanceof ZodError) {
        error.issues.forEach(issue => {
          const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
          errors.push(`${path}: ${issue.message}`);
        });
      } else if (error instanceof Error) {
        errors.push(error.message);
      } else {
        errors.push('Validation failed');
      }
    }

    // Validate business logic
    if (errors.length === 0) {
      const businessLogicResult = validateTradingConfigBusinessLogic(
        config as unknown as Parameters<typeof validateTradingConfigBusinessLogic>[0]
      );
      if (!businessLogicResult.valid) {
        errors.push(...businessLogicResult.errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get default configuration
   * 
   * @returns Default trading configuration
   */
  getDefaultConfig(): AgentTradingConfig {
    return JSON.parse(JSON.stringify(DEFAULT_TRADING_CONFIG));
  }

  /**
   * Save agent configuration to database
   * 
   * Saves the configuration and invalidates cache.
   * Normalizes mode field and removes continuousTrailing before saving.
   * 
   * @param agentId - Agent ID
   * @param config - Configuration to save (null to use defaults)
   * @throws ConfigServiceError if agent not found or config is invalid
   */
  async saveAgentConfig(agentId: string, config: AgentTradingConfig | null): Promise<void> {
    // Normalize and validate if config is provided
    if (config !== null) {
      // Deep clone to avoid mutating the original
      const normalizedConfig = JSON.parse(JSON.stringify(config)) as AgentTradingConfig;

      // Ensure mode is set (default to 'fixed' if missing)
      if (normalizedConfig.stopLoss && !normalizedConfig.stopLoss.mode) {
        normalizedConfig.stopLoss.mode = 'fixed';
      }

      // Remove continuousTrailing if present (no longer used) - use deep deletion
      if (normalizedConfig.stopLoss && 'continuousTrailing' in normalizedConfig.stopLoss) {
        delete (normalizedConfig.stopLoss as Record<string, unknown>).continuousTrailing;
      }

      // Update config reference to use normalized version
      config = normalizedConfig;

      const validationResult = this.validateConfig(normalizedConfig);
      if (!validationResult.valid) {
        // Include actual error messages in the error message for debugging
        const errorDetails = validationResult.errors.length > 0
          ? ` Errors: ${validationResult.errors.join('; ')}`
          : '';
        throw new ConfigServiceError(
          `Invalid trading configuration${errorDetails}`,
          'INVALID_CONFIG',
          { errors: validationResult.errors }
        );
      }
    }

    // Verify agent exists
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true },
    });

    if (!agent) {
      throw new ConfigServiceError(
        `Agent not found: ${agentId}`,
        'AGENT_NOT_FOUND'
      );
    }

    // Save to database
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        tradingConfig: config === null ? Prisma.JsonNull : (config as unknown as Prisma.InputJsonValue),
      },
    });

    // Invalidate cache (will reload on next read with new data)
    await redisConfigService.invalidateAgentConfig(agentId);
  }
}

// Export singleton instance
export const configService = new ConfigService();

