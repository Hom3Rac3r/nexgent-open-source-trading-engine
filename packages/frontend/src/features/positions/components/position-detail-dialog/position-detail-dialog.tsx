'use client';

/**
 * Position Detail Dialog Component
 * 
 * Displays detailed information about a selected position, including position details
 * and purchase transaction information.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs';
import { Copy, X, ExternalLink, Target, Moon } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { Progress } from '@/shared/components/ui/progress';
import { useTransaction, useTransactions } from '@/features/transactions';
import type { TransactionRoutes, RoutePlanStep } from '@/features/transactions/types/transaction.types';
import { formatLocalTime, formatPrice, formatCurrency } from '@/shared/utils/formatting';
import type { AgentTransaction } from '@/shared/types/api.types';
import type { LivePosition } from '@/features/agents';
import { useAgentTradingConfig } from '@/features/agents';
import { getTakeProfitLevelsForMode } from '@nexgent/shared';
import { LoadingSpinner } from '@/shared/components';
import type { PositionDetailDialogProps } from '../../types/position.types';

/**
 * Get total take-profit levels from agent trading config.
 */
function getTotalTakeProfitLevelsFromConfig(config: { takeProfit?: { enabled?: boolean; mode?: string; levels?: unknown[] } } | null | undefined): number {
  if (!config?.takeProfit?.enabled) return 4;
  const mode = config.takeProfit.mode;
  const levels = config.takeProfit.levels;
  if (mode === 'custom' && Array.isArray(levels)) return levels.length;
  const templateLevels = getTakeProfitLevelsForMode((mode as 'aggressive' | 'moderate' | 'conservative' | 'custom') || 'moderate');
  return templateLevels.length || 4;
}

/**
 * Format profit/loss with color and sign
 */
function formatProfitLoss(
  value: number | undefined,
  currencyPreference: 'USD' | 'SOL',
  solPrice: number
): { text: string; className: string } {
  if (value === undefined || isNaN(value)) {
    return { text: 'N/A', className: 'text-muted-foreground' };
  }

  const isPositive = value >= 0;
  const colorClass = isPositive ? 'text-green-600' : 'text-red-600';

  return {
    text: formatCurrency(value, currencyPreference, solPrice, { showSign: true }),
    className: colorClass,
  };
}

/**
 * Format percentage with color
 */
function formatPercentage(value: number | undefined): { text: string; className: string } {
  if (value === undefined || isNaN(value)) {
    return { text: 'N/A', className: 'text-muted-foreground' };
  }

  const isPositive = value >= 0;
  const sign = isPositive ? '+' : '';
  const colorClass = isPositive ? 'text-green-600' : 'text-red-600';
  const text = `${sign}${value.toFixed(2)}%`;

  return { text, className: colorClass };
}

/**
 * Type guard to check if routes has routePlan
 */
function hasRoutePlan(routes: unknown): routes is TransactionRoutes {
  return (
    typeof routes === 'object' &&
    routes !== null &&
    'routePlan' in routes &&
    Array.isArray((routes as TransactionRoutes).routePlan)
  );
}

/**
 * Extract route labels from transaction routes
 */
function getRouteLabels(routes: unknown): string {
  if (!hasRoutePlan(routes)) return '';
  const labels = routes.routePlan
    ?.map((r: RoutePlanStep) => r.swapInfo?.label)
    .filter(Boolean);
  return labels?.length ? ` via ${labels.join(', ')}` : '';
}

/**
 * Get transaction type display text
 */
function getTransactionTypeText(transaction: AgentTransaction): string {
  if (transaction.transactionType === 'SWAP') {
    return `Swap${getRouteLabels(transaction.routes)}`;
  }
  return transaction.transactionType;
}

/**
 * Safely parse a value that can be string or number
 */
function safeParseFloat(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Format transaction amount with appropriate decimals (SOL: at least 4, others: 2)
 */
function formatTransactionAmount(value: number, symbol: string): string {
  const decimals = symbol === 'SOL' ? 4 : 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: 8 });
}

/**
 * Transaction Details Component
 * 
 * Reusable component to display transaction details (used for both original purchase and DCA purchases)
 */
function TransactionDetails({
  transaction,
  solPrice,
}: {
  transaction: AgentTransaction;
  solPrice: number;
}) {
  return (
    <div className="space-y-6">
      {/* Swap Details */}
      <div className="space-y-4">
        {/* From Section */}
        <div className="p-4 bg-muted/30 border rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">From</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-2xl font-bold">
                {transaction.inputAmount && transaction.inputSymbol
                  ? `${formatTransactionAmount(safeParseFloat(transaction.inputAmount), transaction.inputSymbol)} ${transaction.inputSymbol}`
                  : transaction.inputSymbol
                    ? `N/A ${transaction.inputSymbol}`
                    : 'N/A'}
              </div>
              <div className="text-sm text-muted-foreground">
                <div>
                  Token Price (USD): {transaction.inputPrice && solPrice
                    ? formatPrice(safeParseFloat(transaction.inputPrice) * solPrice, true)
                    : 'N/A'}
                </div>
                {transaction.inputMint !== 'So11111111111111111111111111111111111111112' && (
                  <div>
                    Token Price (SOL): {transaction.inputPrice
                      ? formatPrice(safeParseFloat(transaction.inputPrice), false)
                      : 'N/A'}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Token Address</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {transaction.inputMint
                    ? `${transaction.inputMint.slice(0, 8)}...${transaction.inputMint.slice(-8)}`
                    : ''}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() =>
                    transaction.inputMint &&
                    navigator.clipboard.writeText(transaction.inputMint)
                  }
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Swap Arrow */}
        <div className="flex justify-center">
          <div className="p-2 bg-muted rounded-full">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-white"
            >
              <path d="M8 3L4 7l4 4" />
              <path d="M4 7h16" />
              <path d="M16 21l4-4-4-4" />
              <path d="M20 17H4" />
            </svg>
          </div>
        </div>

        {/* To Section */}
        <div className="p-4 bg-muted/30 border rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">To</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-2xl font-bold">
                {transaction.outputAmount && transaction.outputSymbol
                  ? `${formatTransactionAmount(safeParseFloat(transaction.outputAmount), transaction.outputSymbol)} ${transaction.outputSymbol}`
                  : 'N/A'}
              </div>
              <div className="text-sm text-muted-foreground">
                <div>
                  Token Price (USD): {transaction.outputPrice && solPrice
                    ? formatPrice(safeParseFloat(transaction.outputPrice) * solPrice, true)
                    : 'N/A'}
                </div>
                {transaction.outputMint !== 'So11111111111111111111111111111111111111112' && (
                  <div>
                    Token Price (SOL): {transaction.outputPrice
                      ? formatPrice(safeParseFloat(transaction.outputPrice), false)
                      : 'N/A'}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Token Address</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {transaction.outputMint
                    ? `${transaction.outputMint.slice(0, 8)}...${transaction.outputMint.slice(-8)}`
                    : ''}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() =>
                    transaction.outputMint &&
                    navigator.clipboard.writeText(transaction.outputMint)
                  }
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Type and Time - Moved under swap details */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Type</span>
          <span className="font-medium capitalize">
            {getTransactionTypeText(transaction)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Time</span>
          <span className="font-medium">{formatLocalTime(transaction.transactionTime)}</span>
        </div>
      </div>

      {/* Summary Grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Total Value (USD)</span>
          <span className="font-medium">
            ${safeParseFloat(transaction.transactionValueUsd).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        {transaction.priceImpact != null ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Slippage</span>
            <span className="font-medium">
              {transaction.priceImpact != null
                ? `${(Math.abs(safeParseFloat(transaction.priceImpact)) * 100).toFixed(2)}%`
                : 'N/A'}
            </span>
          </div>
        ) : (
          <div></div>
        )}
      </div>

      {/* Fees */}
      {(transaction.protocolFeeSol || transaction.networkFeeSol) && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Protocol Fee</span>
            <span className="font-medium">
              {transaction.protocolFeeSol
                ? `${parseFloat(transaction.protocolFeeSol).toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 9 })} SOL`
                : '—'}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Network Fee</span>
            <span className="font-medium">
              {transaction.networkFeeSol
                ? `${parseFloat(transaction.networkFeeSol).toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 9 })} SOL`
                : '—'}
            </span>
          </div>
        </div>
      )}

      {/* Route Information */}
      {hasRoutePlan(transaction.routes) && (
        <div className="space-y-3">
          <div className="text-sm font-medium">Route Details</div>
          <div className="space-y-3">
            {transaction.routes.routePlan?.map((route: RoutePlanStep, index: number) => (
              <div key={index} className="p-3 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{route.swapInfo?.label || 'N/A'}</span>
                  <span className="text-xs text-muted-foreground">{route.percent || 0}% of swap</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Input Mint</div>
                    <div className="flex items-center gap-2">
                      <div className="font-mono">
                        {route.swapInfo?.inputMint
                          ? `${route.swapInfo.inputMint.slice(0, 8)}...${route.swapInfo.inputMint.slice(-8)}`
                          : ''}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 shrink-0"
                        onClick={() =>
                          route.swapInfo?.inputMint &&
                          navigator.clipboard.writeText(route.swapInfo.inputMint)
                        }
                      >
                        <Copy className="h-2 w-2" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Output Mint</div>
                    <div className="flex items-center gap-2">
                      <div className="font-mono">
                        {route.swapInfo?.outputMint
                          ? `${route.swapInfo.outputMint.slice(0, 8)}...${route.swapInfo.outputMint.slice(-8)}`
                          : ''}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 shrink-0"
                        onClick={() =>
                          route.swapInfo?.outputMint &&
                          navigator.clipboard.writeText(route.swapInfo.outputMint)
                        }
                      >
                        <Copy className="h-2 w-2" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">In Amount (Lamports)</div>
                    <div className="font-mono">{route.swapInfo?.inAmount || 'N/A'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Out Amount (Lamports)</div>
                    <div className="font-mono">{route.swapInfo?.outAmount || 'N/A'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Fee Amount (Lamports)</div>
                    <div className="font-mono">{route.swapInfo?.feeAmount || 'N/A'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Fee Mint</div>
                    <div className="flex items-center gap-2">
                      <div className="font-mono">
                        {route.swapInfo?.feeMint
                          ? `${route.swapInfo.feeMint.slice(0, 8)}...${route.swapInfo.feeMint.slice(-8)}`
                          : ''}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 shrink-0"
                        onClick={() =>
                          route.swapInfo?.feeMint &&
                          navigator.clipboard.writeText(route.swapInfo.feeMint)
                        }
                      >
                        <Copy className="h-2 w-2" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">Label</div>
                    <div className="font-mono">{route.swapInfo?.label || 'N/A'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-muted-foreground">AMM Key</div>
                    <div className="flex items-center gap-2">
                      <div className="font-mono">
                        {route.swapInfo?.ammKey
                          ? `${route.swapInfo.ammKey.slice(0, 8)}...${route.swapInfo.ammKey.slice(-8)}`
                          : ''}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 shrink-0"
                        onClick={() =>
                          route.swapInfo?.ammKey &&
                          navigator.clipboard.writeText(route.swapInfo.ammKey)
                        }
                      >
                        <Copy className="h-2 w-2" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PositionDetailDialog({
  position,
  isOpen,
  onOpenChange,
  onClosePosition,
  currencyPreference,
  solPrice,
}: PositionDetailDialogProps) {
  const [purchaseTab, setPurchaseTab] = useState<'original' | 'dca' | 'takeprofit'>('original');

  // Track position ID to reset tab only when switching to a different position
  const prevPositionIdRef = useRef<string | null>(null);

  // Fetch purchase transaction details
  const purchaseTransactionId = position?.purchaseTransactionId;
  const { data: purchaseTransaction, isLoading: isLoadingTransaction } = useTransaction(
    purchaseTransactionId || undefined
  );

  // Use the purchase transaction's signalId to query DCA and take-profit transactions directly
  // from the API. This is more reliable than depending on dcaTransactionIds/takeProfitTransactionIds
  // arrays from the WebSocket position, which can be stale or empty.
  const signalId = purchaseTransaction?.signalId;
  const agentId = position?.agentId;

  const {
    data: dcaTransactions = [],
    isLoading: isLoadingDCAs,
    isError: hasDcaErrors,
    refetch: refetchDcaTransactions,
  } = useTransactions(
    { agentId: agentId || '', signalId: signalId ?? undefined, isDca: true },
    { enabled: !!agentId && signalId != null }
  );

  const {
    data: takeProfitTransactions = [],
    isLoading: isLoadingTakeProfits,
    isError: hasTakeProfitErrors,
    refetch: refetchTakeProfitTransactions,
  } = useTransactions(
    { agentId: agentId || '', signalId: signalId ?? undefined, isTakeProfit: true },
    { enabled: !!agentId && signalId != null }
  );

  // Agent trading config for total take-profit levels (custom vs preset)
  const { data: tradingConfig } = useAgentTradingConfig(position?.agentId);

  // Calculate take-profit stats
  const takeProfitStats = useMemo(() => {
    if (!position) return null;
    
    const originalAmount = position.purchaseAmount;
    const remainingAmount = position.remainingAmount ?? originalAmount;
    const soldAmount = originalAmount - remainingAmount;
    const soldPercent = originalAmount > 0 ? (soldAmount / originalAmount) * 100 : 0;
    const levelsHit = position.takeProfitLevelsHit || 0;
    // Use position's stored totalTakeProfitLevels (append-levels model) if set,
    // then fall back to agent config, then derive from levelsHit
    const totalLevels = (position as any).totalTakeProfitLevels
      ?? (tradingConfig
        ? getTotalTakeProfitLevelsFromConfig(tradingConfig)
        : Math.max(4, levelsHit)); // Fallback when config not loaded
    
    // Use stored realizedProfitSol when DCA has occurred (transaction-based calc is fragile with DCA),
    // otherwise calculate from transactions for backward compatibility
    const realizedPnL = position.dcaCount > 0
      ? (position.realizedProfitSol ?? 0)
      : takeProfitTransactions.reduce((sum, tx) => {
          // Take-profit sells tokens for SOL; use net SOL after fees
          const solReceived = safeParseFloat(tx.outputAmount)
            - safeParseFloat(tx.protocolFeeSol)
            - safeParseFloat(tx.networkFeeSol);
          // Cost basis for sold tokens = (soldTokens / originalAmount) * totalInvestedSol
          const soldTokens = safeParseFloat(tx.inputAmount);
          const costBasis = originalAmount > 0 
            ? (soldTokens / originalAmount) * position.totalInvestedSol 
            : 0;
          return sum + (solReceived - costBasis);
        }, 0);
    
    return {
      originalAmount,
      remainingAmount,
      soldAmount,
      soldPercent,
      levelsHit,
      totalLevels,
      realizedPnL,
      moonBagActivated: position.moonBagActivated,
      moonBagAmount: position.moonBagAmount,
    };
  }, [position, takeProfitTransactions, tradingConfig]);

  // Reset to original tab only when the dialog opens for a DIFFERENT position.
  // Using a ref comparison avoids resetting on every price-update re-render.
  useEffect(() => {
    const currentId = position?.id ?? null;
    if (isOpen && currentId && currentId !== prevPositionIdRef.current) {
      setPurchaseTab('original');
    }
    prevPositionIdRef.current = currentId;
  }, [position?.id, isOpen]);

  if (!position) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Position Details</DialogTitle>
          <DialogDescription>
            Detailed information about the selected position
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {/* Close Position Button */}
          <div>
            <Button
              variant="destructive"
              onClick={onClosePosition}
              className="w-full flex items-center justify-center gap-2"
            >
              <X className="h-4 w-4" />
              Close Position
            </Button>
          </div>

          {/* Position Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Token</label>
              <div className="mt-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{position.tokenSymbol}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => {
                      window.open(`https://dexscreener.com/solana/${position.tokenAddress}`, '_blank');
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-1">
                  {position.tokenAddress}
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Amount</label>
              <div className="mt-1">
                {takeProfitStats && takeProfitStats.soldPercent > 0 ? (
                  <div>
                    <span className="font-medium">
                      {takeProfitStats.remainingAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">
                      ({(100 - takeProfitStats.soldPercent).toFixed(0)}% remaining)
                    </span>
                  </div>
                ) : (
                  <span className="font-medium">
                    {position.purchaseAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Signal ID</label>
              <div className="mt-1 font-medium">
                {purchaseTransaction?.signalId || (
                  <span className="text-muted-foreground">N/A</span>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Position Size (SOL)</label>
              <div className="mt-1 font-medium">
                {formatPrice(
                  position.totalInvestedSol ?? (position.purchasePrice * position.purchaseAmount),
                  false
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Average Purchase Price ({currencyPreference})</label>
              <div className="mt-1 font-medium">
                {formatPrice(
                  currencyPreference === 'USD' 
                    ? position.purchasePrice * solPrice 
                    : position.purchasePrice,
                  currencyPreference === 'USD'
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Current Price ({currencyPreference})</label>
              <div className="mt-1 font-medium">
                {formatPrice(
                  currencyPreference === 'USD' 
                    ? (position.currentPrice ?? position.purchasePrice) * solPrice 
                    : (position.currentPrice ?? position.purchasePrice),
                  currencyPreference === 'USD'
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Profit / Loss ({currencyPreference})</label>
              <div className="mt-1">
                <span className={formatProfitLoss(
                  currencyPreference === 'USD' ? position.profitLossUsd : position.profitLossSol,
                  currencyPreference,
                  solPrice
                ).className}>
                  {formatProfitLoss(
                    currencyPreference === 'USD' ? position.profitLossUsd : position.profitLossSol,
                    currencyPreference,
                    solPrice
                  ).text}
                </span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Price Change</label>
              <div className="mt-1">
                <span className={formatPercentage(position.priceChangePercent).className}>
                  {formatPercentage(position.priceChangePercent).text}
                </span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Stop Loss Price</label>
              <div className="mt-1 font-medium">
                {position.currentStopLossPercentage !== null ? (
                  (() => {
                    const basePrice = position.peakPrice || position.purchasePrice;
                    const stopLossPriceSol = basePrice * (1 + position.currentStopLossPercentage / 100);
                    return (
                      <span>
                        {formatPrice(
                          currencyPreference === 'USD'
                            ? stopLossPriceSol * solPrice
                            : stopLossPriceSol,
                          currencyPreference === 'USD'
                        )}
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Opened</label>
              <div className="mt-1 font-medium">
                {formatLocalTime(position.createdAt)}
              </div>
            </div>
          </div>

          {/* Take-Profit Status Section - Show if take-profit is enabled (always show for now) */}
          {takeProfitStats && (
            <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-green-600" />
                  <span className="font-medium">Take-Profit Progress</span>
                </div>
                <Badge 
                  variant="outline" 
                  className="border-green-500/50 bg-green-500/10 text-green-600"
                >
                  {takeProfitStats.levelsHit}/{takeProfitStats.totalLevels} Levels
                </Badge>
              </div>
              
              <Progress 
                value={(takeProfitStats.levelsHit / takeProfitStats.totalLevels) * 100} 
                className="h-2"
              />
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Sold:</span>
                  <span className="ml-2 font-medium">
                    {takeProfitStats.soldAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({takeProfitStats.soldPercent.toFixed(0)}%)
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Realized P&L:</span>
                  <span className={`ml-2 font-medium ${takeProfitStats.realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {takeProfitStats.realizedPnL >= 0 ? '+' : ''}{takeProfitStats.realizedPnL.toFixed(4)} SOL
                  </span>
                </div>
              </div>
              
              {takeProfitStats.moonBagActivated && (
                <div className="flex items-center gap-2 pt-2 border-t text-yellow-600 dark:text-yellow-500">
                  <Moon className="h-4 w-4 shrink-0" fill="currentColor" strokeWidth={0} />
                  <span className="text-sm">
                    Moon bag active: <span className="font-medium">
                      {takeProfitStats.moonBagAmount?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'} tokens
                    </span>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Purchase Transaction Section */}
          <div className="pt-4 border-t">
            <div className="mb-4">
              <h3 className="text-lg font-semibold">Purchase Transaction</h3>
              <p className="text-sm text-muted-foreground">
                Detailed information about purchase transactions
              </p>
            </div>

            <Tabs
              value={purchaseTab}
              onValueChange={(value) => {
                setPurchaseTab(value as 'original' | 'dca' | 'takeprofit');
              }}
              className="w-full"
            >
              <TabsList className={`grid w-full ${position.takeProfitLevelsHit > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <TabsTrigger value="original">Original</TabsTrigger>
                <TabsTrigger value="dca">
                  DCA ({position.dcaCount || 0})
                </TabsTrigger>
                {position.takeProfitLevelsHit > 0 && (
                  <TabsTrigger value="takeprofit">
                    Take-Profit ({position.takeProfitLevelsHit})
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="original" className="space-y-6 mt-4 min-h-[400px]">
                {isLoadingTransaction ? (
                  <div className="text-center py-8">
                    <LoadingSpinner size="sm" text="Loading transaction details..." />
                  </div>
                ) : !purchaseTransaction ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No purchase transaction found for this position
                  </div>
                ) : (
                  <TransactionDetails transaction={purchaseTransaction} solPrice={solPrice} />
                )}
              </TabsContent>

              <TabsContent value="dca" className="space-y-6 mt-4 min-h-[400px]">
                {isLoadingDCAs ? (
                  <div className="text-center py-8">
                    <LoadingSpinner size="sm" text="Loading DCA transactions..." />
                  </div>
                ) : dcaTransactions.length === 0 && hasDcaErrors ? (
                  <div className="text-center py-8 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Failed to load DCA transactions.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchDcaTransactions()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : dcaTransactions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No DCA purchases found for this position
                  </div>
                ) : (
                  <div className="space-y-6">
                    {dcaTransactions.map((dcaTransaction, index) => (
                      <div key={dcaTransaction.id} className="space-y-4">
                        {dcaTransactions.length > 1 && (
                          <div className="text-sm font-medium text-muted-foreground border-b pb-2">
                            DCA Purchase #{index + 1}
                          </div>
                        )}
                        <TransactionDetails transaction={dcaTransaction} solPrice={solPrice} />
                        {index < dcaTransactions.length - 1 && (
                          <div className="border-t pt-4" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {position.takeProfitLevelsHit > 0 && (
                <TabsContent value="takeprofit" className="space-y-6 mt-4 min-h-[400px]">
                  {isLoadingTakeProfits ? (
                    <div className="text-center py-8">
                      <LoadingSpinner size="sm" text="Loading take-profit transactions..." />
                    </div>
                  ) : takeProfitTransactions.length === 0 && hasTakeProfitErrors ? (
                    <div className="text-center py-8 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Failed to load take-profit transactions.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetchTakeProfitTransactions()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : takeProfitTransactions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No take-profit transactions found
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Transaction List */}
                      {takeProfitTransactions.map((tpTransaction, index) => (
                        <div key={tpTransaction.id} className="space-y-4">
                          <div className="flex items-center gap-2 border-b pb-2">
                            <Target className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-medium">
                              Take-Profit Level #{index + 1}
                            </span>
                          </div>
                          <TransactionDetails transaction={tpTransaction} solPrice={solPrice} />
                          {index < takeProfitTransactions.length - 1 && (
                            <div className="border-t pt-4" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
