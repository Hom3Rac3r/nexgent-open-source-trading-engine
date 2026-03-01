/**
 * Shared constants for auto-trade features (re-entry, reconciliation, config update).
 *
 * Centralised here so every auto-trade code-path uses the same signal metadata
 * and the same set of "expected skip" error codes.
 */

/** Signal type persisted for synthetic auto-trade trading signals. */
export const AUTO_TRADE_SIGNAL_TYPE = 'Auto-trade';

/** Signal source persisted for synthetic auto-trade trading signals. */
export const AUTO_TRADE_SIGNAL_SOURCE = 'Trading Engine';

/**
 * TradingExecutorError codes that represent expected no-op outcomes.
 * These are logged at info level rather than warn/error because they
 * indicate a guardrail prevented a redundant or unsafe purchase.
 */
export const EXPECTED_AUTO_TRADE_SKIP_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_BALANCE',
  'BELOW_MINIMUM_THRESHOLD',
  'POSITION_EXISTS',
  'MAX_POSITIONS_EXCEEDED',
  'PRICE_IMPACT_TOO_HIGH',
]);
