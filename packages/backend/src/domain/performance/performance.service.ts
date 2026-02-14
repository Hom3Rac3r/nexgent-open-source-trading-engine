/**
 * Performance Service
 * 
 * Aggregates agent performance metrics from various sources:
 * - Historical trades (PostgreSQL) for realized PnL, win rate, etc.
 * - Active positions (Redis) for unrealized PnL
 * - Wallet balances (Redis/DB) for portfolio value
 */

import { prisma } from '@/infrastructure/database/client.js';
import { redisPositionService } from '@/infrastructure/cache/redis-position-service.js';
import { redisBalanceService } from '@/infrastructure/cache/redis-balance-service.js';
import { redisPriceService } from '@/infrastructure/cache/redis-price-service.js';

// SOL Mint Address
const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';

/**
 * Safely convert a value from Redis (may be number, string, or Prisma Decimal serialized as object) to number.
 * Positions stored via JSON.stringify can have Decimal fields as objects; Number(object) is NaN.
 * This ensures remainingAmount (and other amounts) are correct when take-profit has run.
 */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isNaN(n) ? NaN : n;
  }
  // Prisma Decimal / Decimal.js may serialize as object with toString or numeric props
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toString === 'function') {
      const n = parseFloat(String(obj.toString()));
      return Number.isNaN(n) ? NaN : n;
    }
    if (typeof obj.toNumber === 'function') return Number((obj as { toNumber: () => number }).toNumber());
  }
  return NaN;
}

export interface AgentPerformanceSummary {
  portfolioBalanceSol: number;
  totalProfitLossSol: number;
  realizedProfitLossSol: number;
  unrealizedProfitLossSol: number;
  averageReturn: number; // Percentage
  winRate: number; // Percentage
  totalClosedTrades: number;
  totalOpenPositions: number;
}

export class PerformanceService {
  private static instance: PerformanceService;

  private constructor() {}

  public static getInstance(): PerformanceService {
    if (!PerformanceService.instance) {
      PerformanceService.instance = new PerformanceService();
    }
    return PerformanceService.instance;
  }

  /**
   * Get aggregated performance metrics for an agent
   * 
   * @param agentId - Agent ID
   * @param timeframe - Timeframe for historical data ('24h' | 'all')
   * @param walletAddress - Optional wallet address to filter by trading mode
   */
  public async getAgentPerformance(
    agentId: string,
    timeframe: '24h' | 'all' = 'all',
    walletAddress?: string
  ): Promise<AgentPerformanceSummary> {
    // 1. Get historical metrics from database (filtered by wallet if provided)
    // This includes realized profit from FULLY CLOSED positions
    const historicalMetrics = await this.getHistoricalMetrics(agentId, timeframe, walletAddress);

    // 2. Get active positions and calculate unrealized PnL (filtered by wallet if provided)
    // This also returns realized profit from PARTIAL TAKE-PROFIT sales on open positions
    const positionMetrics = await this.getPositionMetrics(agentId, walletAddress);

    // 3. Get current SOL balance (filtered by wallet if provided)
    const solBalance = await this.getSolBalance(agentId, walletAddress);

    // 4. Aggregate everything
    // Total realized = closed trades + partial take-profit sales on open positions
    const totalRealizedProfitLossSol = 
      historicalMetrics.realizedProfitLossSol + positionMetrics.realizedProfitFromTakeProfits;
    
    // Total P/L = all realized profit + unrealized profit on remaining holdings
    const totalProfitLossSol = totalRealizedProfitLossSol + positionMetrics.unrealizedProfitLossSol;

    // Portfolio Balance = SOL Balance + Value of all positions (current price * remaining amount)
    // Note: Uses remainingAmount for positions with partial take-profits, not purchaseAmount.
    // This is critical: SOL balance already includes proceeds from take-profit sales,
    // so position value should only reflect tokens currently held.
    const portfolioBalanceSol = solBalance + positionMetrics.totalPositionsValueSol;

    return {
      portfolioBalanceSol,
      totalProfitLossSol,
      realizedProfitLossSol: totalRealizedProfitLossSol,
      unrealizedProfitLossSol: positionMetrics.unrealizedProfitLossSol,
      averageReturn: historicalMetrics.averageReturn,
      winRate: historicalMetrics.winRate,
      totalClosedTrades: historicalMetrics.totalClosedTrades,
      totalOpenPositions: positionMetrics.count,
    };
  }

  /**
   * Calculate metrics from historical closed trades
   */
  private async getHistoricalMetrics(agentId: string, timeframe: '24h' | 'all', walletAddress?: string) {
    const whereClause: { agentId: string; walletAddress?: string; saleTime?: { gte: Date } } = {
      agentId,
    };

    // Filter by wallet address if provided (for trading mode filtering)
    if (walletAddress) {
      whereClause.walletAddress = walletAddress;
    }

    if (timeframe === '24h') {
      whereClause.saleTime = {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      };
    }

    // Aggregations
    const aggregates = await prisma.agentHistoricalSwap.aggregate({
      where: whereClause,
      _sum: {
        profitLossSol: true,
      },
      _avg: {
        changePercent: true,
      },
      _count: {
        id: true,
      },
    });

    // Calculate win rate manually (count winning trades)
    const winningTradesCount = await prisma.agentHistoricalSwap.count({
      where: {
        ...whereClause,
        profitLossSol: {
          gt: 0,
        },
      },
    });

    const totalClosedTrades = aggregates._count.id;
    const winRate = totalClosedTrades > 0 
      ? (winningTradesCount / totalClosedTrades) * 100 
      : 0;

    return {
      realizedProfitLossSol: aggregates._sum.profitLossSol?.toNumber() || 0,
      averageReturn: aggregates._avg.changePercent?.toNumber() || 0,
      totalClosedTrades,
      winRate,
    };
  }

  /**
   * Calculate metrics from active positions (Redis) for a specific wallet
   * 
   * IMPORTANT: Uses remainingAmount (not purchaseAmount) for positions with partial take-profits.
   * This ensures position value reflects only tokens currently held, not tokens already sold.
   * Also tracks realized profit from partial take-profit sales (stored on position.realizedProfitSol).
   * 
   * Cost basis for unrealized P&L is computed using the actual cost of sold tokens from TP
   * transactions, not a proportional share of totalInvestedSol. This is critical when DCA
   * buys interleave with take-profit sales (changing the average cost after tokens were sold).
   */
  private async getPositionMetrics(agentId: string, walletAddress?: string) {
    const positionIds = await redisPositionService.getAgentPositionIds(agentId);
    
    let unrealizedProfitLossSol = 0;
    let totalPositionsValueSol = 0;
    let realizedProfitFromTakeProfits = 0; // Profit from partial take-profit sales
    let count = 0;

    // Collect all TP transaction IDs across positions for a single batch query
    const tpTxIdsByPosition = new Map<string, string[]>();
    const positionsToProcess: Array<{ id: string; position: Record<string, unknown> }> = [];

    for (const id of positionIds) {
      let position = await redisPositionService.getPosition(id);
      if (!position) continue;

      // Filter by walletAddress if provided
      if (walletAddress && position.walletAddress !== walletAddress) continue;

      // If this position has take-profit activity but remainingAmount didn't round-trip from Redis,
      // refresh cache from DB so we use correct remaining amount (fixes existing stale cache).
      const levelsHit = (position as Record<string, unknown>).takeProfitLevelsHit as number | undefined;
      const remainingNum = toNumber((position as Record<string, unknown>).remainingAmount);
      if ((levelsHit ?? 0) > 0 && Number.isNaN(remainingNum)) {
        const dbPosition = await prisma.agentPosition.findUnique({ where: { id } });
        if (dbPosition) {
          await redisPositionService.setPosition(dbPosition);
          position = dbPosition;
        }
      }

      const posRecord = position as Record<string, unknown>;
      positionsToProcess.push({ id, position: posRecord });

      // Collect TP transaction IDs for batch lookup
      const tpTxIds = posRecord.takeProfitTransactionIds as string[] | undefined;
      if (tpTxIds && tpTxIds.length > 0) {
        tpTxIdsByPosition.set(id, tpTxIds);
      }
    }

    // Batch-fetch all TP transactions to compute actual sale proceeds per position
    // This is needed for correct cost basis when DCA interleaves with take-profit
    const allTpTxIds = Array.from(tpTxIdsByPosition.values()).flat();
    const tpProceedsByTxId = new Map<string, number>();

    if (allTpTxIds.length > 0) {
      const tpTransactions = await prisma.agentTransaction.findMany({
        where: { id: { in: allTpTxIds } },
        select: {
          id: true,
          outputAmount: true,
          protocolFeeSol: true,
          networkFeeSol: true,
        },
      });

      for (const tx of tpTransactions) {
        const output = tx.outputAmount != null ? parseFloat(tx.outputAmount.toString()) : 0;
        const protocolFee = tx.protocolFeeSol != null ? parseFloat(tx.protocolFeeSol.toString()) : 0;
        const networkFee = tx.networkFeeSol != null ? parseFloat(tx.networkFeeSol.toString()) : 0;
        tpProceedsByTxId.set(tx.id, output - protocolFee - networkFee);
      }
    }

    for (const { id, position } of positionsToProcess) {
      count++;
      // Values from Redis may be Prisma Decimals (serialized as object); use safe conversion
      const purchasePrice = toNumber(position.purchasePrice);
      const purchaseAmountNum = toNumber(position.purchaseAmount);
      const remainingAmountNum = toNumber(position.remainingAmount);
      // Use remainingAmount for positions with partial take-profits, fallback to purchaseAmount
      // This is critical: after take-profit sales, remainingAmount reflects current holdings
      const currentHolding = Number.isNaN(remainingAmountNum) ? purchaseAmountNum : remainingAmountNum;
      if (!Number.isFinite(currentHolding) || currentHolding < 0) continue;

      // Track realized profit from partial take-profit sales
      // This profit is NOT in historical swaps (those are only for fully closed positions)
      const positionRealizedProfit = toNumber(position.realizedProfitSol ?? 0);
      realizedProfitFromTakeProfits += Number.isFinite(positionRealizedProfit) ? positionRealizedProfit : 0;

      // Get current price from cache
      // Note: Token addresses in Redis Price Service are normalized to lowercase
      const tokenAddr = String(position.tokenAddress ?? '');
      const currentPriceData = await redisPriceService.getPrice(tokenAddr.toLowerCase());

      let currentPrice = Number.isFinite(purchasePrice) ? purchasePrice : 0; // Fallback to purchase price if no live price (0 PnL)
      if (currentPriceData) {
        currentPrice = currentPriceData.priceSol;
      }

      const totalInvestedSolNum = toNumber(position.totalInvestedSol);
      const currentValue = currentPrice * currentHolding;
      if (!Number.isFinite(currentValue)) continue;

      // Calculate remaining cost basis correctly for positions with both DCA and take-profit.
      //
      // The proportional formula `(currentHolding / purchaseAmount) * totalInvestedSol`
      // breaks when TP sells tokens at one average cost and DCA later changes the average.
      // Instead, compute remaining cost = totalInvestedSol - cost_of_sold_tokens.
      //
      // We derive cost_of_sold_tokens from TP proceeds and realized profit:
      //   realizedProfitSol = TP_proceeds - cost_of_sold_tokens
      //   cost_of_sold_tokens = TP_proceeds - realizedProfitSol
      //   remaining_cost = totalInvestedSol - TP_proceeds + realizedProfitSol
      let costBasis: number;
      const tpTxIds = tpTxIdsByPosition.get(id);

      if (tpTxIds && tpTxIds.length > 0 && Number.isFinite(totalInvestedSolNum) && totalInvestedSolNum > 0) {
        // Compute total net TP proceeds from actual transactions
        let totalTPProceeds = 0;
        for (const txId of tpTxIds) {
          const proceeds = tpProceedsByTxId.get(txId);
          if (proceeds != null && Number.isFinite(proceeds)) {
            totalTPProceeds += proceeds;
          }
        }

        // remaining_cost = totalInvested - TP_proceeds + realizedProfit
        // This is always correct regardless of DCA/TP ordering
        const safeRealizedProfit = Number.isFinite(positionRealizedProfit) ? positionRealizedProfit : 0;
        costBasis = totalInvestedSolNum - totalTPProceeds + safeRealizedProfit;
      } else if (Number.isFinite(totalInvestedSolNum) && totalInvestedSolNum > 0 && purchaseAmountNum > 0) {
        // No TP activity — proportional formula is correct
        costBasis = (currentHolding / purchaseAmountNum) * totalInvestedSolNum;
      } else {
        // Fallback for old positions without totalInvestedSol
        costBasis = purchasePrice * currentHolding;
      }

      if (!Number.isFinite(costBasis)) continue;

      totalPositionsValueSol += currentValue;
      unrealizedProfitLossSol += (currentValue - costBasis);
    }

    return {
      unrealizedProfitLossSol,
      totalPositionsValueSol,
      realizedProfitFromTakeProfits, // Realized profit from partial take-profit sales on open positions
      count,
    };
  }

  /**
   * Get detailed balance breakdown for snapshot purposes
   * Returns all components needed for balance snapshots for a specific wallet
   */
  public async getBalanceBreakdown(agentId: string, walletAddress: string): Promise<{
    portfolioBalanceSol: number;
    solBalance: number;
    positionsValueSol: number;
    unrealizedPnLSol: number;
  }> {
    const positionMetrics = await this.getPositionMetrics(agentId, walletAddress);
    const solBalance = await this.getSolBalance(agentId, walletAddress);
    const portfolioBalanceSol = solBalance + positionMetrics.totalPositionsValueSol;

    return {
      portfolioBalanceSol,
      solBalance,
      positionsValueSol: positionMetrics.totalPositionsValueSol,
      unrealizedPnLSol: positionMetrics.unrealizedProfitLossSol,
    };
  }

  /**
   * Get SOL balance for a specific wallet, or all wallets if walletAddress not provided
   */
  private async getSolBalance(agentId: string, walletAddress?: string): Promise<number> {
    if (walletAddress) {
      // Get balance for specific wallet
      const cached = await redisBalanceService.getBalance(agentId, walletAddress, SOL_MINT_ADDRESS);
      
      let totalSol = 0;
      
      if (cached) {
        totalSol = parseFloat(cached.balance);
      } else {
        // Fallback to DB
        const balance = await prisma.agentBalance.findUnique({
          where: {
            walletAddress_tokenAddress: {
              walletAddress,
              tokenAddress: SOL_MINT_ADDRESS,
            },
          },
        });
        
        if (balance) {
          totalSol = parseFloat(balance.balance);
        }
      }

      // Handle lamports conversion if necessary
      if (totalSol > 1_000_000) {
        return totalSol / 1_000_000_000;
      }

      return totalSol;
    } else {
      // Get all wallets for the agent (for overall performance)
      const wallets = await prisma.agentWallet.findMany({
        where: { agentId },
        select: { walletAddress: true },
      });

      let totalSol = 0;

      for (const wallet of wallets) {
        const cached = await redisBalanceService.getBalance(agentId, wallet.walletAddress, SOL_MINT_ADDRESS);
        
        if (cached) {
          totalSol += parseFloat(cached.balance);
        } else {
          const balance = await prisma.agentBalance.findUnique({
            where: {
              walletAddress_tokenAddress: {
                walletAddress: wallet.walletAddress,
                tokenAddress: SOL_MINT_ADDRESS,
              },
            },
          });
          
          if (balance) {
            totalSol += parseFloat(balance.balance);
          }
        }
      }

      // Handle lamports conversion if necessary
      if (totalSol > 1_000_000) {
        return totalSol / 1_000_000_000;
      }

      return totalSol;
    }
  }
}

export const performanceService = PerformanceService.getInstance();

