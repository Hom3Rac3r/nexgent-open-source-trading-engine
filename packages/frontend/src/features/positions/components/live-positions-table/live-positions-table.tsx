'use client';

/**
 * Live Positions Table Component
 * 
 * Displays a real-time view of active positions managed by the agent.
 * Uses WebSocket for real-time position and price updates.
 */

import { useState, useRef, useCallback, useEffect, memo } from 'react';
import dynamic from 'next/dynamic';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Button } from '@/shared/components/ui/button';
import { Bot, ExternalLink, Moon } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/components/ui/tooltip';
import type { LivePosition } from '@/features/agents';
import { useAgentSelection } from '@/shared/contexts/agent-selection.context';
import { useCurrency } from '@/shared/contexts/currency.context';
import { formatLocalTime, formatPrice, formatCurrency, abbreviateAddress } from '@/shared/utils/formatting';
import { LoadingSpinner, ErrorMessage, TableSkeleton } from '@/shared/components';
import { useClosePosition } from '../../hooks/use-close-position';
import { InsufficientBalance } from '../insufficient-balance';
import { ListeningForSignals } from '../listening-for-signals';
import { AssignWallet } from '../assign-wallet';
import { AutomatedTradingToggle } from '../automated-trading-toggle';
import { useAgentBalances, useAgent, useAgentTradingConfig } from '@/features/agents';
import { getTakeProfitLevelsForMode } from '@nexgent/shared';
import { useTradingMode } from '@/shared/contexts/trading-mode.context';
import { useWallet } from '@/shared/contexts/wallet.context';
import { useMemo } from 'react';

// Lazy load dialog components - they're only shown when needed
const ClosePositionDialog = dynamic(
  () => import('../close-position-dialog/close-position-dialog').then(mod => ({ default: mod.ClosePositionDialog })),
  {
    loading: () => <LoadingSpinner size="sm" />,
    ssr: false
  }
);
const PositionDetailDialog = dynamic(
  () => import('../position-detail-dialog/position-detail-dialog').then(mod => ({ default: mod.PositionDetailDialog })),
  {
    loading: () => <LoadingSpinner size="sm" />,
    ssr: false
  }
);
import type { LivePositionsTableProps } from '../../types/position.types';

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
 * Check if position has take-profit activity
 */
function hasTakeProfitActivity(position: LivePosition): boolean {
  return position.takeProfitLevelsHit > 0 || position.moonBagActivated;
}

/**
 * Calculate remaining percentage of position
 */
function getRemainingPercent(position: LivePosition): number {
  if (position.remainingAmount === null || position.remainingAmount === undefined) {
    return 100;
  }
  if (position.purchaseAmount === 0) return 0;
  return (position.remainingAmount / position.purchaseAmount) * 100;
}

/**
 * Get total take-profit levels from agent trading config.
 * Uses configured levels (custom mode) or template for preset modes; fallback 4 when not enabled or loading.
 */
function getTotalTakeProfitLevelsFromConfig(config: { takeProfit?: { enabled?: boolean; mode?: string; levels?: unknown[] } } | null | undefined): number {
  if (!config?.takeProfit?.enabled) return 4;
  const mode = config.takeProfit.mode;
  const levels = config.takeProfit.levels;
  if (mode === 'custom' && Array.isArray(levels)) return levels.length;
  const templateLevels = getTakeProfitLevelsForMode((mode as 'aggressive' | 'moderate' | 'conservative' | 'custom') || 'moderate');
  return templateLevels.length || 4;
}

// SOL mint address constant
const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
const MINIMUM_BALANCE_SOL = 0.5;

function LivePositionsTableComponent({
  positions,
  isConnected,
  isConnecting,
  connectionError,
}: LivePositionsTableProps) {
  const { selectedAgentId } = useAgentSelection();
  const { currencyPreference, solPrice } = useCurrency();
  const { tradingMode, isLoading: isLoadingTradingMode } = useTradingMode();
  const { wallets, isLoading: isLoadingWallets } = useWallet();
  const { data: agent } = useAgent(selectedAgentId || undefined);
  const { data: tradingConfig } = useAgentTradingConfig(selectedAgentId || undefined);

  // Total take-profit levels from agent config (for X/Y display)
  const totalTakeProfitLevels = useMemo(
    () => getTotalTakeProfitLevelsFromConfig(tradingConfig ?? null),
    [tradingConfig]
  );

  // Check if trading is paused for the current trading mode
  const isPaused = agent && tradingMode
    ? tradingMode === 'live'
      ? !agent.automatedTradingLive
      : !agent.automatedTradingSimulation
    : false;

  // Get wallet for current trading mode
  const walletForMode = useMemo(() => {
    if (!tradingMode || !selectedAgentId || wallets.length === 0) {
      return null;
    }
    return wallets.find((w) => w.walletType === tradingMode) || null;
  }, [tradingMode, selectedAgentId, wallets]);

  // Determine if we should fetch balances
  // Only fetch when we have a wallet for the current trading mode
  const shouldFetchBalances = !!selectedAgentId && !isLoadingWallets && !!walletForMode?.walletAddress;

  // Check balance to determine if we should show insufficient balance message
  const { data: balances = [], isLoading: isLoadingBalances } = useAgentBalances(
    selectedAgentId || undefined,
    walletForMode?.walletAddress,
    shouldFetchBalances
  );

  const solBalance = balances.find((b) => b.tokenAddress === SOL_MINT_ADDRESS);
  const balanceValue = solBalance ? parseFloat(solBalance.balance) : 0;

  // Unified loading state: wait for all critical data to be ready
  const isLoading = isLoadingTradingMode || isLoadingWallets || isLoadingBalances;

  // Determine what to show once loading is complete
  // Check if no wallet assigned (for live mode, show AssignWallet; for simulation, wallet is auto-created)
  const hasNoWallet = !isLoading && !walletForMode && tradingMode === 'live';
  const hasInsufficientBalance = !isLoading && walletForMode && balanceValue < MINIMUM_BALANCE_SOL;
  // Only show full InsufficientBalance component when there are NO positions - otherwise show positions with a warning
  const hasPositions = positions && positions.length > 0;
  const showInsufficientBalanceFullScreen = hasInsufficientBalance && !hasPositions;
  const showInsufficientBalanceWarning = hasInsufficientBalance && hasPositions;
  const shouldShowWebSocketStatus = !hasNoWallet && !showInsufficientBalanceFullScreen; // Show WebSocket status if wallet exists and not showing full insufficient balance screen
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [closePositionDialogOpen, setClosePositionDialogOpen] = useState(false);
  const [positionToClose, setPositionToClose] = useState<LivePosition | null>(null);
  const { closePosition, isClosing: isClosingPosition } = useClosePosition();

  // Derive selectedPosition from the live positions array so it stays in sync
  // with WebSocket updates (DCA, take-profit, price changes, etc.)
  const selectedPosition = useMemo(
    () => (selectedPositionId ? positions.find(p => p.id === selectedPositionId) ?? null : null),
    [positions, selectedPositionId]
  );

  // Animation tracking for price updates
  const previousPricesRef = useRef<Record<string, number>>({});
  const animationTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const [animatingPositions, setAnimatingPositions] = useState<Set<string>>(new Set());

  // Helper function to start animation for a specific position
  const startPositionAnimation = useCallback((positionId: string) => {
    // Clear any existing timer for this position
    const existingTimer = animationTimersRef.current.get(positionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Add position to animating set
    setAnimatingPositions(prev => new Set([...prev, positionId]));

    // Set new timer for this position (1.5s to match CSS animation)
    const timer = setTimeout(() => {
      setAnimatingPositions(prev => {
        const newSet = new Set(prev);
        newSet.delete(positionId);
        return newSet;
      });
      animationTimersRef.current.delete(positionId);
    }, 1500); // Match the CSS animation duration

    animationTimersRef.current.set(positionId, timer);
  }, []);

  // Cleanup animation timers on unmount
  useEffect(() => {
    const timers = animationTimersRef.current;
    return () => {
      // Clear all timers when component unmounts
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Detect price changes and trigger animations
  useEffect(() => {
    if (!positions || positions.length === 0) {
      return;
    }

    positions.forEach(position => {
      const previousPrice = previousPricesRef.current[position.id];
      // Use currentPrice (SOL) for comparison, fallback to purchasePrice if not available
      const currentPrice = position.currentPrice ?? position.purchasePrice;

      // If we have a previous price and it's different, start animation
      if (previousPrice !== undefined && previousPrice !== currentPrice) {
        startPositionAnimation(position.id);
      }

      // Update the price for next comparison
      previousPricesRef.current[position.id] = currentPrice;
    });
  }, [positions, startPositionAnimation]);

  const handlePositionClick = useCallback((position: LivePosition) => {
    setSelectedPositionId(position.id);
    setIsDetailsDialogOpen(true);
  }, []);

  const handleClosePosition = useCallback((position: LivePosition) => {
    setPositionToClose(position);
    setClosePositionDialogOpen(true);
  }, []);

  const handleConfirmClosePosition = useCallback(async () => {
    if (!positionToClose || !selectedAgentId) return;

    try {
      await closePosition(selectedAgentId, positionToClose);

      // Close dialog
      setClosePositionDialogOpen(false);
      setPositionToClose(null);

      // Close details dialog if it's open for the same position
      if (selectedPositionId === positionToClose.id) {
        setIsDetailsDialogOpen(false);
        setSelectedPositionId(null);
      }

      // WebSocket will automatically update the positions list
    } catch (error) {
      // Error is already handled by the hook
    }
  }, [positionToClose, selectedAgentId, selectedPositionId, closePosition]);

  if (!selectedAgentId) {
    return (
      <Card className="relative transition-all duration-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Live Agent Trades
          </CardTitle>
          <CardDescription>
            A real-time view of trades your agent is actively managing via WebSocket connection. Follow price movements, execution strategies, and market conditions as they evolve.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative p-2 md:p-4">
          <div className="text-center py-12 text-muted-foreground">
            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Please select an agent to view live trades</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative transition-all duration-300">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <CardTitle>Live Agent Trades</CardTitle>
            <CardDescription>
              A real-time view of trades your agent is actively managing via WebSocket connection. Follow price movements, execution strategies, and market conditions as they evolve.
            </CardDescription>
          </div>
          <AutomatedTradingToggle />
        </div>
      </CardHeader>
      <CardContent className="relative p-2 md:p-4">
        {/* Paused Trading Banner */}
        {isPaused && (
          <Alert className="mb-4 border-orange-500/20 bg-orange-500/10">
            <AlertDescription className="text-orange-600 dark:text-orange-400">
              <strong>Trading is paused</strong> for {tradingMode === 'live' ? 'live' : 'simulation'} mode. Your agent will not execute any automated trades until trading is resumed.
            </AlertDescription>
          </Alert>
        )}
        {/* Unified loading state - show skeleton until all critical data is loaded */}
        {isLoading ? (
          <div className="rounded-md border relative overflow-x-auto w-full">
            <TableSkeleton rows={3} columns={8} showHeader={true} />
          </div>
        ) : hasNoWallet ? (
          /* Show assign wallet prompt when no wallet is assigned for live mode */
          <AssignWallet />
        ) : showInsufficientBalanceFullScreen ? (
          /* Show insufficient balance only when there are NO positions */
          <InsufficientBalance walletAddress={walletForMode?.walletAddress} />
        ) : (
          <>
            {/* Show warning banner when balance is low but positions exist */}
            {showInsufficientBalanceWarning && (
              <Alert className="mb-4 border-orange-500/20 bg-orange-500/10">
                <AlertDescription className="text-orange-600 dark:text-orange-400">
                  <strong>Low balance warning:</strong> Your SOL balance is below the minimum ({MINIMUM_BALANCE_SOL} SOL). DCA and new trades may not execute until you add funds.
                </AlertDescription>
              </Alert>
            )}

            {/* Only show WebSocket status when balance is sufficient */}
            {shouldShowWebSocketStatus && connectionError && (
              <ErrorMessage
                error={connectionError}
                className="mb-4"
                message={`Connection error: ${connectionError}`}
              />
            )}

            {shouldShowWebSocketStatus && isConnecting && (
              <div className="mb-4 flex items-center justify-center py-4">
                <LoadingSpinner size="sm" text="Connecting to WebSocket..." />
              </div>
            )}

            <div className="rounded-md border relative overflow-x-auto w-full">
              {positions.length === 0 ? (
                <ListeningForSignals />
              ) : (
                <Table className="min-w-[200px] text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Token</TableHead>
                      <TableHead className="hidden md:table-cell">Amount</TableHead>
                      <TableHead className="hidden lg:table-cell">Avg Price ({currencyPreference})</TableHead>
                      <TableHead className="hidden lg:table-cell">Current ({currencyPreference})</TableHead>
                      <TableHead>P/L ({currencyPreference})</TableHead>
                      <TableHead className="hidden md:table-cell">Change</TableHead>
                      <TableHead className="hidden lg:table-cell">Take-Profit</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position) => {
                      // Calculate display values based on currency preference
                      const purchasePrice = currencyPreference === 'USD'
                        ? (position.purchasePrice * solPrice)
                        : position.purchasePrice;

                      const currentPrice = currencyPreference === 'USD'
                        ? (position.currentPriceUsd ?? position.purchasePrice * solPrice)
                        : (position.currentPrice ?? position.purchasePrice);

                      const profitLoss = currencyPreference === 'USD'
                        ? (position.profitLossUsd ?? 0)
                        : (position.profitLossSol ?? 0);

                      const changePercent = position.priceChangePercent ?? 0;

                      return (
                        <TableRow
                          key={position.id}
                          className={`cursor-pointer hover:bg-accent/40 ${animatingPositions.has(position.id)
                              ? 'animate-highlight'
                              : 'transition-all duration-300'
                            }`}
                          onClick={() => handlePositionClick(position)}
                        >
                          <TableCell>{formatLocalTime(position.createdAt)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="font-medium">{position.tokenSymbol}</div>
                                <div className="text-xs text-muted-foreground font-mono">
                                  {abbreviateAddress(position.tokenAddress)}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(`https://dexscreener.com/solana/${position.tokenAddress}`, '_blank');
                                }}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            {position.remainingAmount != null && position.remainingAmount !== position.purchaseAmount ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div>
                                      <span className="font-medium">
                                        {position.remainingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                      <span className="text-xs text-muted-foreground ml-1">
                                        ({getRemainingPercent(position).toFixed(0)}%)
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <div className="text-xs">
                                      <div>Original: {position.purchaseAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                      <div>Sold: {(position.purchaseAmount - (position.remainingAmount ?? position.purchaseAmount)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              position.purchaseAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            )}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {formatPrice(purchasePrice, currencyPreference === 'USD')}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {formatPrice(currentPrice, currencyPreference === 'USD')}
                          </TableCell>
                          <TableCell className={`font-mono ${profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(profitLoss, currencyPreference, solPrice, { showSign: true })}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <span className={changePercent >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {`${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`}
                            </span>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            {hasTakeProfitActivity(position) ? (
                              (() => {
                                // Use position's stored totalTakeProfitLevels (append-levels model) if set,
                                // then fall back to agent config, then derive from levelsHit
                                const totalLevels = (position as any).totalTakeProfitLevels
                                  ?? (tradingConfig ? totalTakeProfitLevels : Math.max(4, position.takeProfitLevelsHit));
                                return (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="flex items-center gap-1.5">
                                          <Badge 
                                            variant="outline" 
                                            className={`inline-flex items-center justify-center text-xs h-7 w-10 shrink-0 ${
                                              position.takeProfitLevelsHit > 0 
                                                ? 'border-green-500/50 bg-green-500/10 text-green-600' 
                                                : 'border-muted'
                                            }`}
                                          >
                                            {position.takeProfitLevelsHit}/{totalLevels}
                                          </Badge>
                                          {position.moonBagActivated && (
                                            <Badge 
                                              variant="outline" 
                                              className="inline-flex items-center justify-center text-xs h-7 w-10 shrink-0 border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-500"
                                            >
                                              <Moon className="h-3 w-3 shrink-0" fill="currentColor" strokeWidth={0} />
                                            </Badge>
                                          )}
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-xs">
                                        <div className="space-y-1 text-xs">
                                          <div className="font-medium">Take-Profit Progress</div>
                                          <div>Levels hit: {position.takeProfitLevelsHit} of {totalLevels}</div>
                                          <div>Remaining: {getRemainingPercent(position).toFixed(0)}% of position</div>
                                          {position.moonBagActivated && (
                                            <div className="text-yellow-600 dark:text-yellow-500">🌙 Moon bag active</div>
                                          )}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              })()
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClosePosition(position);
                              }}
                              className="h-8"
                            >
                              Close Position
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}

        {/* Position Details Dialog */}
        <PositionDetailDialog
          position={selectedPosition}
          isOpen={isDetailsDialogOpen}
          onOpenChange={setIsDetailsDialogOpen}
          onClosePosition={() => {
            setIsDetailsDialogOpen(false);
            if (selectedPosition) {
              handleClosePosition(selectedPosition);
            }
          }}
          currencyPreference={currencyPreference}
          solPrice={solPrice}
        />

        {/* Close Position Confirmation Dialog */}
        <ClosePositionDialog
          position={positionToClose}
          isOpen={closePositionDialogOpen}
          onOpenChange={setClosePositionDialogOpen}
          onConfirm={handleConfirmClosePosition}
          isClosing={isClosingPosition}
        />
      </CardContent>
    </Card>
  );
}

// Memoize component to prevent unnecessary re-renders when parent updates
export const LivePositionsTable = memo(LivePositionsTableComponent);
