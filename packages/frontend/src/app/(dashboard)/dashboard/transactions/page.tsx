'use client';

/**
 * Transaction History Page
 * 
 * Displays all agent transactions (DEPOSIT, SWAP, BURN) with filtering,
 * pagination, and detailed transaction views.
 * 
 * Features:
 * - Server-side pagination with client-side filtering for contract addresses
 * - Filter by transaction type, contract address/symbol, and signal ID
 * - Responsive design: card layout for mobile, table rows for desktop
 * - CSV export functionality
 * - Detailed transaction dialog for viewing full transaction information
 */

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/shared/components/ui/pagination';
import { Badge } from '@/shared/components/ui/badge';
import { Filter, Download, Loader2 } from 'lucide-react';
import { useTransactions } from '@/features/transactions';
import { useCurrency } from '@/shared/contexts/currency.context';
import { useAgentSelection } from '@/shared/contexts/agent-selection.context';
import { useTradingMode } from '@/shared/contexts/trading-mode.context';
import { useWallet } from '@/shared/contexts/wallet.context';
import type { AgentTransaction } from '@/shared/types/api.types';
import { downloadTransactionsCSV } from '@/shared/utils/csv';
import { TableSkeleton, CardSkeleton, ErrorState, LoadingSpinner } from '@/shared/components';

// Lazy load dialog component - only shown when user clicks on a transaction
const TransactionDetailDialog = dynamic(
  () => import('@/features/transactions').then(mod => ({ default: mod.TransactionDetailDialog })),
  { 
    loading: () => <LoadingSpinner size="sm" />,
    ssr: false 
  }
);

/** Number of transactions to display per page */
const PAGE_SIZE = 10;

/**
 * Format transaction date to match reference design
 * 
 * @param dateString - ISO date string
 * @returns Formatted date string in format "Nov 25, 2025 • 07:27 PM"
 * 
 * @example
 * formatTransactionDate('2025-11-25T19:27:00Z') // "Nov 25, 2025 • 07:27 PM"
 */
function formatTransactionDate(dateString: string): string {
  const date = new Date(dateString);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} • ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Extract DEX/platform names from transaction routes
 * 
 * Routes are stored as JSON and contain a routePlan array with swapInfo objects
 * that have label properties indicating the DEX/platform used.
 * 
 * @param routes - Routes data from transaction (unknown type due to JSON storage)
 * @returns Comma-separated string of DEX names, or null if none found
 * 
 * @example
 * getDexNames({ routePlan: [{ swapInfo: { label: 'Pump.fun Amm' } }] }) // "Pump.fun Amm"
 */
function getDexNames(routes: unknown): string | null {
  if (!routes || typeof routes !== 'object') return null;
  
  // Type guard for route plan structure
  const routesObj = routes as { routePlan?: Array<{ swapInfo?: { label?: string } }> };
  if (routesObj.routePlan && Array.isArray(routesObj.routePlan)) {
    const dexNames = routesObj.routePlan
      .map((r) => r.swapInfo?.label)
      .filter((label): label is string => Boolean(label));
    return dexNames.length > 0 ? dexNames.join(', ') : null;
  }
  
  return null;
}

/**
 * Transaction History Page Component
 * 
 * Main component for displaying and managing agent transaction history.
 * Handles filtering, pagination, CSV export, and transaction detail viewing.
 */
export default function TransactionsPage() {
  const { currencyPreference, solPrice } = useCurrency();
  const { selectedAgentId } = useAgentSelection();
  const { tradingMode } = useTradingMode();
  const { wallets } = useWallet();

  // Get wallet for current trading mode
  const walletForMode = wallets.find((w) => w.walletType === tradingMode);
  const walletAddress = walletForMode?.walletAddress;
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<'all' | 'DEPOSIT' | 'SWAP' | 'BURN'>('all');
  const [contractAddressFilter, setContractAddressFilter] = useState('');
  const [signalIdFilter, setSignalIdFilter] = useState('');
  
  // Dialog state
  const [selectedTransaction, setSelectedTransaction] = useState<AgentTransaction | null>(null);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  
  // CSV export state
  const [isDownloading, setIsDownloading] = useState(false);

  // Reset to first page when agent changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedAgentId]);

  /**
   * Fetch all transactions from API with server-side filtering
   * 
   * Fetches a large batch to enable client-side pagination and filtering.
   * Filters by transaction type, signal ID, and wallet address (trading mode) on the server.
   * Contract address filtering is done client-side.
   */
  const { data: allTransactions = [], isLoading, isError, error, refetch } = useTransactions({
    agentId: selectedAgentId || '',
    walletAddress, // Filter by current trading mode wallet
    transactionType: transactionTypeFilter !== 'all' ? transactionTypeFilter : undefined,
    signalId: signalIdFilter || undefined,
    limit: 1000, // Fetch enough for client-side pagination
    offset: 0,
  }, { enabled: !!selectedAgentId && !!walletAddress }); // Only enabled when walletAddress is available

  /**
   * Apply client-side filtering for contract address/symbol
   * 
   * Backend doesn't support contract address filtering, so we filter
   * the fetched transactions by matching input/output symbols and mints.
   */
  const filteredTransactions = useMemo(() => {
    // If no wallet address (no wallet for current trading mode), return empty array
    if (!walletAddress) return [];
    
    let filtered = allTransactions;
    
    // Apply contract address filter if present
    if (contractAddressFilter) {
      const filterLower = contractAddressFilter.toLowerCase();
      filtered = filtered.filter((tx) => {
        const inputSymbol = tx.inputSymbol?.toLowerCase() || '';
        const outputSymbol = tx.outputSymbol?.toLowerCase() || '';
        const inputMint = tx.inputMint?.toLowerCase() || '';
        const outputMint = tx.outputMint?.toLowerCase() || '';
        
        return (
          inputSymbol.includes(filterLower) ||
          outputSymbol.includes(filterLower) ||
          inputMint.includes(filterLower) ||
          outputMint.includes(filterLower)
        );
      });
    }
    
    return filtered;
  }, [allTransactions, contractAddressFilter, walletAddress]);

  /**
   * Calculate pagination
   */
  const totalPages = Math.ceil(filteredTransactions.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedTransactions = filteredTransactions.slice(startIndex, endIndex);

  /**
   * Check if any filters are currently active
   */
  const hasActiveFilters = transactionTypeFilter !== 'all' || contractAddressFilter || signalIdFilter;

  /**
   * Handle transaction card/row click to open detail dialog
   * 
   * @param transaction - The transaction to display in the dialog
   */
  const handleTransactionClick = (transaction: AgentTransaction) => {
    setSelectedTransaction(transaction);
    setIsTransactionDialogOpen(true);
  };

  /**
   * Handle CSV export of filtered transactions
   * 
   * Fetches all transactions matching current filters and exports them as CSV.
   * Uses dynamic import to avoid including the API client in initial bundle.
   */
  const handleDownloadCSV = async () => {
    if (!selectedAgentId) return;
    
    setIsDownloading(true);
    try {
      // Fetch all transactions (with current filters) for CSV export
      const { listAgentTransactions } = await import('@/infrastructure/api/services/agent-transactions.service');
      const allTransactions = await listAgentTransactions({
        agentId: selectedAgentId,
        walletAddress, // Filter by current trading mode wallet
        transactionType: transactionTypeFilter !== 'all' ? transactionTypeFilter : undefined,
        signalId: signalIdFilter || undefined,
        limit: 1000, // Get enough for export
        offset: 0,
      });

      // Apply client-side contract address filter if needed
      const filteredForExport = contractAddressFilter
        ? allTransactions.filter((tx: AgentTransaction) => {
            const filterLower = contractAddressFilter.toLowerCase();
            const inputSymbol = tx.inputSymbol?.toLowerCase() || '';
            const outputSymbol = tx.outputSymbol?.toLowerCase() || '';
            const inputMint = tx.inputMint?.toLowerCase() || '';
            const outputMint = tx.outputMint?.toLowerCase() || '';
            
            return (
              inputSymbol.includes(filterLower) ||
              outputSymbol.includes(filterLower) ||
              inputMint.includes(filterLower) ||
              outputMint.includes(filterLower)
            );
          })
        : allTransactions;

      downloadTransactionsCSV(filteredForExport, currencyPreference, solPrice);
    } catch (error) {
      console.error('Failed to download CSV:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  /**
   * Clear all active filters and reset to first page
   */
  const handleClearFilters = () => {
    setTransactionTypeFilter('all');
    setContractAddressFilter('');
    setSignalIdFilter('');
    setCurrentPage(1);
  };

  /**
   * Reset to first page when filters change
   * 
   * Ensures users don't end up on empty pages after filtering.
   */
  useEffect(() => {
    setCurrentPage(1);
  }, [transactionTypeFilter, signalIdFilter]);

  // No agent selected
  if (!selectedAgentId) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              No agent selected. Please create or select an agent to view transaction history.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-4 py-6">
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
              <div>
                <CardTitle>Transaction History</CardTitle>
                <CardDescription>
                  View your agent&apos;s simulated trading activity and fund transfers.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="flex items-center gap-2"
                >
                  <Filter className="h-4 w-4" />
                  Filters
                  {hasActiveFilters && (
                    <span className="ml-1 h-2 w-2 bg-blue-500 rounded-full" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadCSV}
                  disabled={isDownloading || filteredTransactions.length === 0}
                  className="flex items-center gap-2"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isDownloading ? 'Exporting...' : 'Download CSV'}
                </Button>
              </div>
            </div>

            {/* Filter Panel */}
            {showFilters && (
              <div className="mt-4 p-4 border rounded-lg bg-muted/30 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="transaction-type" className="text-xs">Transaction Type</Label>
                    <Select value={transactionTypeFilter} onValueChange={(value) => setTransactionTypeFilter(value as typeof transactionTypeFilter)}>
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="All types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="SWAP">Swap</SelectItem>
                        <SelectItem value="DEPOSIT">Deposit</SelectItem>
                        <SelectItem value="BURN">Burn</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contract-address" className="text-xs">Contract Address or Symbol</Label>
                    <Input
                      id="contract-address"
                      placeholder="Search by address or symbol..."
                      value={contractAddressFilter}
                      onChange={(e) => setContractAddressFilter(e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signal-id" className="text-xs">Signal ID</Label>
                    <Input
                      id="signal-id"
                      placeholder="Enter signal ID..."
                      value={signalIdFilter}
                      onChange={(e) => setSignalIdFilter(e.target.value)}
                      className="h-8"
                    />
                  </div>
                </div>
                
                {hasActiveFilters && (
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="text-sm text-muted-foreground">
                      Active filters: {[
                        transactionTypeFilter !== 'all' && 'Transaction Type',
                        contractAddressFilter && 'Contract Address',
                        signalIdFilter && 'Signal ID'
                      ].filter(Boolean).join(', ')}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearFilters}
                      className="text-sm"
                    >
                      Clear All
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Transaction List */}
              <div className="rounded-lg border divide-y">
                {isLoading ? (
                  <>
                    {/* Mobile: Skeleton Cards */}
                    <div className="md:hidden p-4">
                      <CardSkeleton count={5} lines={4} />
                    </div>
                    {/* Desktop: Skeleton Rows */}
                    <div className="hidden md:block p-4">
                      <TableSkeleton rows={5} columns={6} showHeader={false} />
                    </div>
                  </>
                ) : isError ? (
                  <ErrorState
                    error={error}
                    onRetry={() => refetch()}
                    title="Failed to load transactions"
                    className="p-8"
                  />
                ) : filteredTransactions.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No transactions found
                  </div>
                ) : (
                  <>
                    {/* Mobile: Card style for each transaction */}
                    <div className="md:hidden space-y-3 p-4">
                      {paginatedTransactions.map((transaction) => (
                        <TransactionCard
                          key={transaction.id}
                          transaction={transaction}
                          currencyPreference={currencyPreference}
                          solPrice={solPrice}
                          onClick={() => handleTransactionClick(transaction)}
                        />
                      ))}
                    </div>
                    {/* Desktop: Row style */}
                    <div className="hidden md:block">
                      {paginatedTransactions.map((transaction) => (
                        <TransactionRow
                          key={transaction.id}
                          transaction={transaction}
                          currencyPreference={currencyPreference}
                          solPrice={solPrice}
                          onClick={() => handleTransactionClick(transaction)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Pagination */}
              {!isLoading && totalPages > 1 && (
                <div className="flex justify-center">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage > 1) {
                              setCurrentPage(currentPage - 1);
                            }
                          }}
                          className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
                        />
                      </PaginationItem>
                      
                      {/* Always show page 1 */}
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setCurrentPage(1);
                          }}
                          isActive={currentPage === 1}
                        >
                          1
                        </PaginationLink>
                      </PaginationItem>
                      
                      {/* Show ellipsis if current page is far from start */}
                      {currentPage > 3 && (
                        <PaginationItem>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )}
                      
                      {/* Show previous page if not page 1 or 2 */}
                      {currentPage > 2 && currentPage !== totalPages && (
                        <PaginationItem>
                          <PaginationLink
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setCurrentPage(currentPage - 1);
                            }}
                          >
                            {currentPage - 1}
                          </PaginationLink>
                        </PaginationItem>
                      )}
                      
                      {/* Show current page if not page 1 */}
                      {currentPage !== 1 && currentPage !== totalPages && (
                        <PaginationItem>
                          <PaginationLink href="#" isActive>
                            {currentPage}
                          </PaginationLink>
                        </PaginationItem>
                      )}
                      
                      {/* Show next page if not last page */}
                      {currentPage < totalPages - 1 && (
                        <PaginationItem>
                          <PaginationLink
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setCurrentPage(currentPage + 1);
                            }}
                          >
                            {currentPage + 1}
                          </PaginationLink>
                        </PaginationItem>
                      )}
                      
                      {/* Show ellipsis if current page is far from end */}
                      {currentPage < totalPages - 2 && (
                        <PaginationItem>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )}
                      
                      {/* Show last page if there's more than one page and not already shown */}
                      {totalPages > 1 && (
                        <PaginationItem>
                          <PaginationLink
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setCurrentPage(totalPages);
                            }}
                            isActive={currentPage === totalPages}
                          >
                            {totalPages}
                          </PaginationLink>
                        </PaginationItem>
                      )}
                      
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            if (currentPage < totalPages) {
                              setCurrentPage(currentPage + 1);
                            }
                          }}
                          className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Detail Dialog */}
      <TransactionDetailDialog
        transaction={selectedTransaction}
        isOpen={isTransactionDialogOpen}
        onOpenChange={setIsTransactionDialogOpen}
        solPrice={solPrice}
      />
    </>
  );
}

/**
 * Transaction Card Component (Mobile View)
 * 
 * Displays transaction information in a card layout optimized for mobile devices.
 * Shows transaction type, date, signal ID, swap details, and transaction value.
 * 
 * @param transaction - The transaction data to display
 * @param currencyPreference - User's preferred currency ('USD' or 'SOL')
 * @param solPrice - Current SOL price in USD for currency conversion
 * @param onClick - Callback function when card is clicked
 */
function TransactionCard({
  transaction,
  currencyPreference,
  solPrice,
  onClick,
}: {
  transaction: AgentTransaction;
  currencyPreference: 'USD' | 'SOL';
  solPrice: number;
  onClick: () => void;
}) {
  const getTransactionIcon = () => {
    switch (transaction.transactionType) {
      case 'DEPOSIT':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-600">
            <path d="M12 20V4m0 16l-4-4m4 4l4-4" />
          </svg>
        );
      case 'BURN':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-600">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
          </svg>
        );
      default: // SWAP
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-600">
            <path d="M19 8H5m6-3l-6 3 6 3"/>
            <path d="M5 16h14m-6-3l6 3-6 3"/>
          </svg>
        );
    }
  };

  const formatValue = (value: string | null) => {
    if (!value) return 'N/A';
    const numValue = parseFloat(value);
    const isNegative = numValue < 0;
    const absValue = Math.abs(numValue);
    const negativePrefix = isNegative ? '-' : '';
    
    if (currencyPreference === 'USD') {
      return `${negativePrefix}$${absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      const solValue = solPrice > 0 ? absValue / solPrice : 0;
      return `${negativePrefix}${solValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`;
    }
  };

  return (
    <div
      className="p-4 bg-card border rounded-lg cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
            {getTransactionIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">
              {transaction.transactionType === 'SWAP' 
                ? 'Swap'
                : transaction.transactionType.charAt(0) + transaction.transactionType.slice(1).toLowerCase() + (transaction.inputSymbol ? ` ${transaction.inputSymbol}` : '')}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatTransactionDate(transaction.transactionTime)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2 flex-wrap justify-end">
          {transaction.isDca && (
            <Badge variant="secondary" className="text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">
              DCA
            </Badge>
          )}
          {transaction.isTakeProfit && (
            <Badge variant="secondary" className="text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
              Take profit
            </Badge>
          )}
          {transaction.signalId && (
            <span className="text-xs bg-muted px-2 py-1 rounded">
              Signal #{transaction.signalId}
            </span>
          )}
        </div>
      </div>

      {transaction.transactionType === 'SWAP' ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground text-center">
            {(() => {
              const dexNames = getDexNames(transaction.routes);
              if (transaction.inputSymbol && transaction.outputSymbol) {
                return dexNames 
                  ? `Swap ${transaction.inputSymbol} for ${transaction.outputSymbol} via ${dexNames}`
                  : `Swap ${transaction.inputSymbol} for ${transaction.outputSymbol}`;
              }
              return 'Swap';
            })()}
          </div>
          {transaction.inputSymbol && transaction.outputSymbol ? (
            <div className="text-center text-sm">
              {transaction.inputAmount ? parseFloat(transaction.inputAmount).toFixed(2) : '0.00'} <span className="font-semibold">{transaction.inputSymbol}</span> → {transaction.outputAmount ? parseFloat(transaction.outputAmount).toFixed(2) : '0.00'} <span className="font-semibold">{transaction.outputSymbol}</span>
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground text-center">
            Amount: {formatValue(transaction.transactionValueUsd)}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-center">
            <span className={`text-lg font-semibold ${
              transaction.transactionType === 'DEPOSIT' ? 'text-emerald-600' : ''
            }`}>
              {transaction.transactionType === 'DEPOSIT' ? '+' : ''}
              {transaction.inputAmount ? parseFloat(transaction.inputAmount).toFixed(2) : '0.00'} {transaction.inputSymbol || ''}
            </span>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            Amount: {formatValue(transaction.transactionValueUsd)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Transaction Row Component (Desktop View)
 * 
 * Displays transaction information in a table row layout optimized for desktop.
 * Shows transaction details, swap information, and transaction value in a horizontal layout.
 * 
 * @param transaction - The transaction data to display
 * @param currencyPreference - User's preferred currency ('USD' or 'SOL')
 * @param solPrice - Current SOL price in USD for currency conversion
 * @param onClick - Callback function when row is clicked
 */
function TransactionRow({
  transaction,
  currencyPreference,
  solPrice,
  onClick,
}: {
  transaction: AgentTransaction;
  currencyPreference: 'USD' | 'SOL';
  solPrice: number;
  onClick: () => void;
}) {
  const getTransactionIcon = () => {
    switch (transaction.transactionType) {
      case 'DEPOSIT':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
            <path d="M12 20V4m0 16l-4-4m4 4l4-4" />
          </svg>
        );
      case 'BURN':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-orange-600">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
          </svg>
        );
      default: // SWAP
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
            <path d="M19 8H5m6-3l-6 3 6 3"/>
            <path d="M5 16h14m-6-3l6 3-6 3"/>
          </svg>
        );
    }
  };

  const formatValue = (value: string | null) => {
    if (!value) return 'N/A';
    const numValue = parseFloat(value);
    const isNegative = numValue < 0;
    const absValue = Math.abs(numValue);
    const negativePrefix = isNegative ? '-' : '';
    
    if (currencyPreference === 'USD') {
      return `${negativePrefix}$${absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      const solValue = solPrice > 0 ? absValue / solPrice : 0;
      return `${negativePrefix}${solValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`;
    }
  };

  const getTransactionDetails = () => {
    if (transaction.transactionType === 'SWAP') {
      const dexNames = getDexNames(transaction.routes);
      if (transaction.inputSymbol && transaction.outputSymbol) {
        return dexNames 
          ? `Swap ${transaction.inputSymbol} for ${transaction.outputSymbol} via ${dexNames}`
          : `Swap ${transaction.inputSymbol} for ${transaction.outputSymbol}`;
      }
      return 'Swap';
    }
    return transaction.transactionType.charAt(0) + transaction.transactionType.slice(1).toLowerCase() + (transaction.inputSymbol ? ` ${transaction.inputSymbol}` : '');
  };

  return (
    <div
      className="p-4 flex flex-row items-center justify-between hover:bg-muted/50 transition-colors cursor-pointer border-b last:border-b-0"
      onClick={onClick}
    >
      <div className="flex flex-row items-center gap-4 flex-1">
        <div className={`h-8 w-8 rounded-full ${
          transaction.transactionType === 'DEPOSIT' 
            ? 'bg-emerald-500/10' 
            : transaction.transactionType === 'BURN'
            ? 'bg-orange-500/10'
            : 'bg-blue-500/10'
        } flex items-center justify-center`}>
          {getTransactionIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            {getTransactionDetails()}
          </div>
          <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5">
            {formatTransactionDate(transaction.transactionTime)}
            {transaction.isDca && (
              <Badge variant="secondary" className="text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">
                DCA
              </Badge>
            )}
            {transaction.isTakeProfit && (
              <Badge variant="secondary" className="text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                Take profit
              </Badge>
            )}
            {transaction.signalId && (
              <span className="text-xs bg-muted px-1.5 py-0.5 rounded-md">
                Signal #{transaction.signalId}
              </span>
            )}
            {transaction.transactionType === 'SWAP' && transaction.routes && (transaction.routes as any)?.routePlan && (transaction.routes as any).routePlan.length > 1 && (
              <span className="text-xs bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded-md">
                {(transaction.routes as any).routePlan.length} steps
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="text-right space-y-1">
        {transaction.transactionType === 'SWAP' ? (
          <>
            {transaction.inputSymbol && transaction.outputSymbol && transaction.inputAmount && transaction.outputAmount ? (
              <div className="text-sm">
                {parseFloat(transaction.inputAmount).toFixed(2)} {transaction.inputSymbol} → {parseFloat(transaction.outputAmount).toFixed(2)} {transaction.outputSymbol}
              </div>
            ) : transaction.inputSymbol && transaction.outputSymbol ? (
              <div className="text-sm">
                {transaction.inputAmount ? parseFloat(transaction.inputAmount).toFixed(2) : '0.00'} {transaction.inputSymbol} → {transaction.outputAmount ? parseFloat(transaction.outputAmount).toFixed(2) : '0.00'} {transaction.outputSymbol}
              </div>
            ) : null}
            <div className="text-sm text-muted-foreground">
              Amount: {formatValue(transaction.transactionValueUsd)}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm">
              {transaction.transactionType === 'DEPOSIT' ? '+' : ''}
              {transaction.inputAmount ? parseFloat(transaction.inputAmount).toFixed(2) : '0.00'} {transaction.inputSymbol || ''}
            </div>
            <div className="text-sm text-muted-foreground">
              Amount: {formatValue(transaction.transactionValueUsd)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

