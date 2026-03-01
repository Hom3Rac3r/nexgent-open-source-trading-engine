/**
 * Auto-Trade Re-entry Manager
 *
 * When an agent has auto-trade enabled and a token is enabled in their token list,
 * positions in that token are re-purchased immediately after close using the agent's
 * standard position size. Listens to position_closed and executes direct purchases.
 */

import { positionEventEmitter } from './position-events.js';
import { configService } from './config-service.js';
import { tradingExecutor, TradingExecutorError } from './trading-executor.service.js';
import { evaluateAutoTradeMarketCapGuard } from './auto-trade-market-cap-guard.js';
import { prisma } from '@/infrastructure/database/client.js';
import { idempotencyService } from '@/infrastructure/cache/idempotency-service.js';
import { REDIS_TTL } from '@/shared/constants/redis-keys.js';
import {
  AUTO_TRADE_SIGNAL_TYPE,
  AUTO_TRADE_SIGNAL_SOURCE,
  EXPECTED_AUTO_TRADE_SKIP_CODES,
} from './auto-trade-constants.js';
import logger from '@/infrastructure/logging/logger.js';
import type { PositionClosedEvent } from './position-events.js';

const AUTO_TRADE_IDEMPOTENCY_PREFIX = 'auto-trade-reentry';

/**
 * Create a synthetic trading signal for auto-trade re-entry.
 *
 * The position details flow groups related DCA and take-profit rows by signal ID.
 * Auto-trade purchases do not originate from the normal signal processor, so we
 * create a signal record here to preserve that linkage behavior.
 */
async function createAutoTradeSignal(params: {
  agentId: string;
  tokenAddress: string;
  tokenSymbol?: string;
}): Promise<number | null> {
  const { agentId, tokenAddress, tokenSymbol } = params;

  try {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { userId: true },
    });

    if (!agent) {
      logger.warn({ agentId, tokenAddress }, 'Auto-trade signal creation skipped: agent not found');
      return null;
    }

    const signal = await prisma.tradingSignal.create({
      data: {
        tokenAddress: tokenAddress.trim(),
        symbol: tokenSymbol?.trim() || null,
        signalType: AUTO_TRADE_SIGNAL_TYPE,
        activationReason: 'Auto-trade re-entry after position close',
        signalStrength: 3,
        source: AUTO_TRADE_SIGNAL_SOURCE,
        userId: agent.userId,
      },
    });

    return signal.id;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn(
      { agentId, tokenAddress, error: errMsg },
      'Auto-trade signal creation failed; continuing without signal link'
    );
    return null;
  }
}

/**
 * Handle position_closed: if auto-trade is enabled and the token is enabled in the
 * agent's token list, immediately trigger a re-purchase.
 */
async function handlePositionClosed(event: PositionClosedEvent): Promise<void> {
  const { agentId, positionId, tokenAddress, tokenSymbol, source } = event;
  const normalizedToken = tokenAddress.trim().toLowerCase();
  const idempotencyKey = `${AUTO_TRADE_IDEMPOTENCY_PREFIX}:${agentId}:${positionId}`;

  try {
    // Wallet reset intentionally emits position_closed to trigger cleanup listeners.
    // Auto-trade must ignore these events to avoid immediately repurchasing after reset.
    if (source === 'wallet_reset') {
      logger.info(
        { agentId, positionId, tokenAddress },
        'Auto-trade re-entry skipped: wallet reset close event'
      );
      return;
    }

    const canProceed = await idempotencyService.checkAndSet(idempotencyKey, REDIS_TTL.IDEMPOTENCY);
    if (!canProceed) {
      logger.debug({ agentId, positionId, tokenAddress }, 'Auto-trade re-entry skipped: duplicate close event');
      return;
    }

    const config = await configService.loadAgentConfig(agentId);
    if (!config.autoTrade?.enabled) return;

    const tokens = config.autoTrade.tokens ?? [];
    const tokenConfig = tokens.find(
      (token) => token.enabled && token.address.trim().toLowerCase() === normalizedToken
    );
    if (!tokenConfig) return;

    const resolvedSymbol = tokenSymbol?.trim() || tokenConfig.symbol?.trim() || undefined;
    const marketCapGuard = await evaluateAutoTradeMarketCapGuard({
      tokenAddress,
      tokenBounds: tokenConfig,
    });
    if (!marketCapGuard.allowed) {
      logger.info(
        {
          agentId,
          positionId,
          tokenAddress,
          reason: marketCapGuard.reason,
          marketCap: marketCapGuard.marketCap,
          marketCapMin: tokenConfig.marketCapMin ?? null,
          marketCapMax: tokenConfig.marketCapMax ?? null,
        },
        'Auto-trade re-entry skipped by market-cap policy'
      );
      return;
    }

    const autoTradeSignalId = await createAutoTradeSignal({
      agentId,
      tokenAddress,
      tokenSymbol: resolvedSymbol,
    });

    logger.info({ agentId, positionId, tokenAddress }, 'Auto-trade re-entry: executing direct purchase');
    const result = await tradingExecutor.executePurchase({
      agentId,
      tokenAddress,
      tokenSymbol: resolvedSymbol,
      signalId: autoTradeSignalId ?? undefined,
    });

    logger.info(
      {
        agentId,
        positionId,
        tokenAddress,
        signalId: autoTradeSignalId,
        transactionId: result.transactionId,
        newPositionId: result.positionId,
      },
      'Auto-trade re-entry purchase executed'
    );
  } catch (error) {
    if (error instanceof TradingExecutorError && error.code && EXPECTED_AUTO_TRADE_SKIP_CODES.has(error.code)) {
      logger.info(
        { agentId, positionId, tokenAddress, code: error.code, reason: error.message },
        'Auto-trade re-entry skipped by execution guardrail'
      );
      return;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.warn(
      { agentId, positionId, tokenAddress, error: errMsg },
      'Auto-trade re-entry: error during position_closed handling'
    );
  }
}

/** Bound handler reference so we can remove it on shutdown. */
const boundHandler = (event: PositionClosedEvent) => {
  handlePositionClosed(event).catch((err) => {
    logger.error({ err, event }, 'Auto-trade re-entry: unhandled error in position_closed');
  });
};

/**
 * Initialize: subscribe to position_closed.
 * Called once at app bootstrap (before PriceUpdateManager.initialize).
 */
export function initializeAutoTradeReentryManager(): void {
  positionEventEmitter.on('position_closed', boundHandler);
  logger.info('Auto-trade re-entry manager initialized');
}

/** Remove the position_closed listener for clean process exit. */
export function shutdownAutoTradeReentryManager(): void {
  positionEventEmitter.off('position_closed', boundHandler);
  logger.info('Auto-trade re-entry manager shut down');
}
