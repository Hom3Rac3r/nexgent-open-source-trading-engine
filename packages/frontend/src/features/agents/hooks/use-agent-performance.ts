'use client';

/**
 * useAgentPerformance Hook
 * 
 * Manages agent performance metrics by combining:
 * 1. Historical data (from API) - Realized PnL, Win Rate, etc.
 * 2. Real-time data (from WebSocket via positions prop) - Unrealized PnL, Portfolio Value
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { agentsService } from '@/infrastructure/api/services/agents.service';
import type { LivePosition, PerformanceSummary, UseAgentPerformanceReturn } from '../types/agent.types';

const INITIAL_METRICS: PerformanceSummary = {
  portfolioBalanceSol: 0,
  totalProfitLossSol: 0,
  realizedProfitLossSol: 0,
  unrealizedProfitLossSol: 0,
  averageReturn: 0,
  winRate: 0,
  totalClosedTrades: 0,
  totalOpenPositions: 0,
};

export function useAgentPerformance(
  agentId: string | null,
  activePositions: LivePosition[],
  timeframe: '24h' | 'all' = 'all',
  walletAddress?: string
): UseAgentPerformanceReturn {
  // Fetch baseline (historical) metrics from API using React Query
  // Filter by walletAddress to show only data for the current trading mode
  const {
    data: baselineMetrics = INITIAL_METRICS,
    isLoading,
    error: queryError,
    refetch: refetchQuery,
  } = useQuery<PerformanceSummary, Error>({
    queryKey: ['agent-performance', agentId, timeframe, walletAddress],
    queryFn: () => agentsService.getAgentPerformance(agentId!, timeframe, walletAddress),
    enabled: !!agentId && !!walletAddress, // Only fetch when we have a wallet for the current trading mode
    staleTime: 10 * 1000, // 10 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchInterval: 10 * 1000, // 10 second polling
    refetchOnWindowFocus: false,
    refetchOnReconnect: false, // Don't refetch on reconnect (polling handles it)
    retry: 1,
  });

  // Convert query error to string for compatibility
  const error = queryError ? (queryError instanceof Error ? queryError.message : 'Unknown error') : null;

  // Wrapper for refetch to match the expected signature
  const refetch = async () => {
    await refetchQuery();
  };

  // Calculate combined metrics (Memoized)
  const metrics = useMemo(() => {
    // If no wallet address is provided (no wallet for current trading mode), return empty metrics
    if (!agentId || !walletAddress) return INITIAL_METRICS;

    // Calculate real-time position values for live price updates between API calls.
    // We compute a "delta" (change since the API snapshot) rather than recomputing absolute
    // unrealized P&L, because the cost basis formula in the frontend cannot correctly handle
    // positions where take-profit and DCA interleave (the backend uses TP transaction lookups
    // for an exact remaining cost basis). The delta approach avoids this issue because the
    // proportional cost basis errors cancel out in the difference.
    let currentPositionsValueSol = 0;
    let currentApproxUnrealizedSol = 0;

    activePositions.forEach(pos => {
      // Use current price if available, otherwise fall back to purchase price (0 PnL)
      const price = pos.currentPrice ?? pos.purchasePrice;
      
      // Use remainingAmount for positions with partial take-profits, fallback to purchaseAmount
      const currentHolding = pos.remainingAmount ?? pos.purchaseAmount;
      
      const value = price * currentHolding;

      // Approximate cost basis for delta calculation only (not used as absolute P&L).
      // Use totalInvestedSol when available for fee-inclusive cost, else purchasePrice.
      const totalInvested = pos.totalInvestedSol ?? (pos.purchasePrice * pos.purchaseAmount);
      const costBasis = pos.purchaseAmount > 0
        ? (currentHolding / pos.purchaseAmount) * totalInvested
        : pos.purchasePrice * currentHolding;

      currentPositionsValueSol += value;
      currentApproxUnrealizedSol += (value - costBasis);
    });

    // Delta approach: only the CHANGE in unrealized P&L since the API snapshot.
    // The proportional cost basis errors cancel out in the difference, so the delta
    // accurately reflects price movements without introducing cost basis drift.
    const unrealizedDelta = currentApproxUnrealizedSol - baselineMetrics.unrealizedProfitLossSol;

    return {
      ...baselineMetrics,
      // Update unrealized PnL: API baseline adjusted by price-change delta
      unrealizedProfitLossSol: baselineMetrics.unrealizedProfitLossSol + unrealizedDelta,

      // Update total PnL: API total adjusted by same delta (keeps realized + unrealized consistent)
      totalProfitLossSol: baselineMetrics.totalProfitLossSol + unrealizedDelta,

      // Update portfolio balance by the same delta
      portfolioBalanceSol: baselineMetrics.portfolioBalanceSol + unrealizedDelta,

      // Update open positions count
      totalOpenPositions: activePositions.length,
    };
  }, [baselineMetrics, activePositions, agentId, walletAddress]);

  return {
    metrics,
    isLoading,
    error,
    refetch,
  };
}

