/**
 * useWebSocket Hook
 * 
 * React hook for managing WebSocket connection to receive real-time position and price updates.
 * Handles connection, reconnection, message handling, and state management.
 * 
 * @module infrastructure/websocket/hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';
import type { OpenPosition } from '@nexgent/shared';
import { useCurrency } from '@/shared/contexts/currency.context';

// Only log in development
const isDev = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => {
  if (isDev) {
    console.log(...args);
  }
};
const logWarn = (...args: unknown[]) => {
  if (isDev) {
    console.warn(...args);
  }
};
const logError = (...args: unknown[]) => {
  console.error(...args); // Always log errors
};
import type {
  WebSocketMessage,
  WSMessage,
  UseWebSocketOptions,
  UseWebSocketReturn,
  LivePosition,
  EnrichedPosition,
  InitialDataMessage,
  PositionUpdateMessage,
  PriceUpdateMessage,
  PriceUpdateBatchMessage,
  ConnectedMessage,
  ErrorMessage,
} from '../types/websocket.types';

// Re-export LivePosition type from features for convenience
export type { LivePosition } from '@/features/agents';

/**
 * Get WebSocket URL
 */
function getWebSocketUrl(agentId: string, token: string): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  // Convert http:// to ws:// or https:// to wss://
  const wsUrl = apiUrl.replace(/^http/, 'ws');
      const url = `${wsUrl}/ws?token=${encodeURIComponent(token)}&agentId=${encodeURIComponent(agentId)}`;
      log('[WebSocket] Connecting to:', url.replace(token, 'TOKEN_HIDDEN'));
      return url;
}

/**
 * useWebSocket Hook
 * 
 * Manages WebSocket connection for real-time position and price updates.
 * 
 * @param agentId - Agent ID to connect for
 * @param options - Hook options
 * @returns WebSocket connection state and data
 * 
 * @example
 * ```tsx
 * const { positions, isConnected } = useWebSocket(agentId);
 * ```
 */
export function useWebSocket(
  agentId: string | null,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const {
    autoConnect = true,
    reconnectInterval = 5000,
    maxReconnectAttempts = 5,
    pingInterval = 30000,
  } = options;

  const { data: session, update: updateSession } = useSession();
  const { solPrice } = useCurrency();
  const queryClient = useQueryClient();
  
  // Extract token value to use in dependency array (prevents re-runs when session object changes)
  const accessToken = session?.accessToken as string | undefined;

  // Ref for the session update function so onclose handlers can trigger a token
  // refresh without adding updateSession to connect()'s dependency array.
  const updateSessionRef = useRef(updateSession);
  updateSessionRef.current = updateSession;

  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [messageCount, setMessageCount] = useState(0);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isManualDisconnect = useRef(false);
  const positionsRef = useRef<LivePosition[]>([]); // Keep ref for price updates
  const lastAgentIdRef = useRef<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);
  const reconnectAttemptsResetTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Timeout to reset attempts after period
  const reconnectAttemptsRef = useRef(0); // Ref to track current reconnect attempts for closure access
  
  // Debouncing refs for batching price updates
  const pendingPriceUpdatesRef = useRef<Map<string, { price: number; priceUsd: number }>>(new Map());
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rafRef = useRef<number | null>(null);

  // Update positions ref when positions change
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  // Update reconnectAttempts ref when it changes
  useEffect(() => {
    reconnectAttemptsRef.current = reconnectAttempts;
  }, [reconnectAttempts]);

  /**
   * Calculate enriched position data with current prices and P/L
   * Uses purchasePriceUsd from position if available (from backend), otherwise calculates it
   * Memoized to avoid recalculation when solPrice changes unnecessarily
   */
  const calculateEnrichedPositionData = useCallback((
    position: OpenPosition & { purchasePriceUsd?: number; realizedProfitSol?: number },
    currentPriceSol: number,
    currentPriceUsd: number
  ): LivePosition => {
    const purchasePriceSol = position.purchasePrice;
    const purchaseAmount = position.purchaseAmount;
    // Use remainingAmount for current holdings (after take-profit sales), fallback to purchaseAmount
    const currentHolding = position.remainingAmount ?? purchaseAmount;
    // Realized profit from take-profit sales (already locked in)
    const realizedProfitSol = position.realizedProfitSol ?? 0;
    
    // CRITICAL: Use existing purchasePriceUsd from position (set by backend on initial_data)
    // Only calculate if missing AND solPrice is valid (>0) to avoid the $0 bug
    let purchasePriceUsd = position.purchasePriceUsd;
    if (!purchasePriceUsd || purchasePriceUsd <= 0) {
      // Only recalculate if solPrice is actually loaded
      if (solPrice > 0) {
        purchasePriceUsd = purchasePriceSol * solPrice;
      } else {
        // Can't calculate - use 0 as fallback (will show incorrect P/L until solPrice loads)
        purchasePriceUsd = 0;
      }
    }
    
    // Calculate current position values (based on remaining holdings, not original amount)
    const positionValueSol = currentPriceSol * currentHolding;
    const positionValueUsd = currentPriceUsd * currentHolding;
    
    // Calculate unrealized profit/loss on remaining tokens
    // Use proportional totalInvestedSol for cost basis so buy-side fees are included.
    // Falls back to purchasePrice * holding for positions without totalInvestedSol.
    const totalInvestedSol = position.totalInvestedSol ?? (purchasePriceSol * purchaseAmount);
    const costBasisSol = (purchaseAmount > 0 && totalInvestedSol > 0)
      ? (currentHolding / purchaseAmount) * totalInvestedSol
      : purchasePriceSol * currentHolding;
    const totalInvestedUsd = purchasePriceUsd * purchaseAmount; // USD uses purchasePriceUsd (set by backend)
    const costBasisUsd = (purchaseAmount > 0 && totalInvestedUsd > 0)
      ? (currentHolding / purchaseAmount) * totalInvestedUsd
      : purchasePriceUsd * currentHolding;
    const unrealizedProfitSol = positionValueSol - costBasisSol;
    const unrealizedProfitUsd = positionValueUsd - costBasisUsd;
    
    // Total P/L = Realized (from take-profit) + Unrealized (on remaining tokens)
    const profitLossSol = realizedProfitSol + unrealizedProfitSol;
    const profitLossUsd = (realizedProfitSol * solPrice) + unrealizedProfitUsd;
    
    // Calculate percentages based on ORIGINAL cost basis for accurate total return
    const originalCostBasisUsd = purchasePriceUsd * purchaseAmount;
    const profitLossPercent = originalCostBasisUsd > 0
      ? (profitLossUsd / originalCostBasisUsd) * 100
      : 0;
    
    const priceChangePercent = purchasePriceSol > 0
      ? ((currentPriceSol - purchasePriceSol) / purchasePriceSol) * 100
      : 0;

    return {
      ...position,
      currentPrice: currentPriceSol,
      currentPriceUsd,
      purchasePriceUsd, // Preserve for future price updates
      priceChangePercent,
      positionValueUsd,
      positionValueSol,
      profitLossUsd,
      profitLossSol,
      profitLossPercent,
    };
  }, [solPrice]);
  
  /**
   * Batch apply pending price updates using requestAnimationFrame for smooth rendering
   */
  const applyPendingPriceUpdates = useCallback(() => {
    if (pendingPriceUpdatesRef.current.size === 0) {
      return;
    }

    const priceMap = new Map(pendingPriceUpdatesRef.current);
    pendingPriceUpdatesRef.current.clear();

    // Use requestAnimationFrame for smooth updates
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      setPositions(prev => {
        const currentPositions = positionsRef.current;
        let hasChanges = false;

        const updated = prev.map(position => {
          const tokenAddressLower = position.tokenAddress.toLowerCase();
          const priceUpdate = priceMap.get(tokenAddressLower);

          if (!priceUpdate) {
            return position;
          }

          const { price, priceUsd } = priceUpdate;

          // Skip if price hasn't changed (avoid unnecessary updates)
          if (position.currentPrice === price && position.currentPriceUsd === priceUsd) {
            return position;
          }

          hasChanges = true;
          return calculateEnrichedPositionData(position, price, priceUsd);
        });

        // Only update if there are actual changes
        if (hasChanges) {
          positionsRef.current = updated;
          return updated;
        }

        return prev;
      });

      rafRef.current = null;
    });
  }, [calculateEnrichedPositionData]);
  
  /**
   * Queue a price update for batching
   */
  const queuePriceUpdate = useCallback((tokenAddress: string, price: number, priceUsd: number) => {
    const tokenAddressLower = tokenAddress.toLowerCase();
    pendingPriceUpdatesRef.current.set(tokenAddressLower, { price, priceUsd });

    // Clear existing timeout
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    // Batch updates every 100ms (10 updates per second max)
    updateTimeoutRef.current = setTimeout(() => {
      applyPendingPriceUpdates();
      updateTimeoutRef.current = null;
    }, 100);
  }, [applyPendingPriceUpdates]);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WSMessage = JSON.parse(event.data);
      setMessageCount(prev => prev + 1);
      setLastUpdateTime(new Date());
      
      // Debug: Log all incoming messages (only in dev)
      log('[WebSocket] Received message:', message.type);

      switch (message.type) {
        case 'connected': {
          const connectedMsg = message as ConnectedMessage;
          log('✅ WebSocket connected:', connectedMsg.data?.agentId);
          setIsConnected(true);
          setIsConnecting(false);
          setConnectionError(null);
          setReconnectAttempts(0);
          reconnectAttemptsRef.current = 0;
          break;
        }

        case 'initial_data': {
          const initialMsg = message as InitialDataMessage;
          const positionCount = initialMsg.data?.positions?.length || 0;
          log(`[WebSocket] 📥 Received initial_data: ${positionCount} position(s)`);
          
          if (initialMsg.data?.positions) {
            // Backend sends fully enriched positions with current prices and P/L already calculated
            // Use backend values directly - DON'T recalculate (avoids solPrice race condition)
            const livePositions: LivePosition[] = initialMsg.data.positions.map((p: EnrichedPosition) => {
              // Use backend-provided values, only fallback if truly missing
              return {
                ...p,
                // Current prices (from backend's price cache)
                currentPrice: p.currentPrice ?? p.purchasePrice,
                currentPriceUsd: p.currentPriceUsd ?? 0,
                // Purchase price in USD (backend calculates correctly)
                purchasePriceUsd: p.purchasePriceUsd ?? 0,
                // Position values (backend calculated)
                positionValueUsd: p.positionValueUsd ?? 0,
                positionValueSol: p.positionValueSol ?? 0,
                // Profit/Loss (backend calculated - USE THESE, don't recalculate!)
                profitLossUsd: p.profitLossUsd ?? 0,
                profitLossSol: p.profitLossSol ?? 0,
                profitLossPercent: p.profitLossPercent ?? 0,
                priceChangePercent: p.priceChangePercent ?? 0,
              };
            });
            
            log(`[WebSocket] ✅ Set ${livePositions.length} position(s) in state`);
            setPositions(livePositions);
            positionsRef.current = livePositions;
          } else {
            // If initial_data has no positions array, preserve existing positions
            // This prevents clearing positions during reconnection if server hasn't sent them yet
            logWarn('[WebSocket] ⚠️  initial_data received but no positions array in data - preserving existing positions');
            // Don't clear positions - keep what we have until we get valid data
          }
          break;
        }

        case 'position_update': {
          const updateMsg = message as PositionUpdateMessage;
          const { eventType, position, positionId } = updateMsg.data || {};
          log(`[WebSocket] 📥 Received position_update: ${eventType} - Position ID: ${position?.id || positionId || 'unknown'}`);

          setPositions(prev => {
            const current = [...prev];

            switch (eventType) {
              case 'position_created':
              case 'position_updated':
                if (position) {
                  const index = current.findIndex(p => p.id === position.id);
                  // Use existing current price if available, otherwise use purchase price as fallback
                  const existingPosition = current[index];
                  const currentPriceSol = existingPosition?.currentPrice ?? position.purchasePrice;
                  const currentPriceUsd = existingPosition?.currentPriceUsd ?? (position.purchasePrice * solPrice);
                  
                  const livePosition = calculateEnrichedPositionData(position, currentPriceSol, currentPriceUsd);
                  
                  if (index >= 0) {
                    current[index] = livePosition;
                  } else {
                    current.push(livePosition);
                  }
                }
                break;

              case 'position_closed':
                if (positionId) {
                  // Invalidate historical swaps query to trigger immediate refetch
                  // This ensures the recent trades table updates immediately when a position closes
                  queryClient.invalidateQueries({
                    queryKey: ['agent-historical-swaps'],
                  });
                  
                  // Invalidate performance query to trigger immediate refetch
                  // This ensures the performance overview updates immediately when a position closes
                  queryClient.invalidateQueries({
                    queryKey: ['agent-performance'],
                  });
                  
                  return current.filter(p => p.id !== positionId);
                }
                break;
            }

            return current;
          });
          break;
        }

        case 'price_update': {
          const priceMsg = message as PriceUpdateMessage;
          const { tokenAddress, price, priceUsd } = priceMsg.data || {};

          if (!tokenAddress || price === undefined || priceUsd === undefined) {
            logWarn('[WebSocket] Invalid price_update message');
            break;
          }

          // Use the ref to get the latest positions (avoids stale closure issues)
          const currentPositions = positionsRef.current;
          const tokenAddressLower = tokenAddress.toLowerCase();

          // Check if we have any positions matching this token
          const hasMatchingPosition = currentPositions.some(
            p => p.tokenAddress.toLowerCase() === tokenAddressLower
          );

          if (!hasMatchingPosition) {
            // Silently skip if no matching positions (expected behavior)
            break;
          }

          // Queue the update for batching instead of immediate update
          queuePriceUpdate(tokenAddress, price, priceUsd);
          break;
        }

        case 'price_update_batch': {
          const batchMsg = message as PriceUpdateBatchMessage;
          const { updates } = batchMsg.data || {};

          if (!updates || !Array.isArray(updates) || updates.length === 0) {
            logWarn('[WebSocket] Invalid price_update_batch message');
            break;
          }

          log(`[WebSocket] 📈 Received batch price update: ${updates.length} token(s)`);

          // Use the ref to get the latest positions (avoids stale closure issues)
          const currentPositions = positionsRef.current;

          // Queue all updates for batching
          let hasMatchingPosition = false;
          updates.forEach(update => {
            if (update.tokenAddress && update.price !== undefined && update.priceUsd !== undefined) {
              const tokenAddressLower = update.tokenAddress.toLowerCase();
              // Check if we have any positions matching this token
              if (currentPositions.some(p => p.tokenAddress.toLowerCase() === tokenAddressLower)) {
                hasMatchingPosition = true;
                queuePriceUpdate(update.tokenAddress, update.price, update.priceUsd);
              }
            }
          });

          if (!hasMatchingPosition && currentPositions.length > 0) {
            log(`[WebSocket] No positions matched tokens in batch`);
          }
          break;
        }

        case 'ping':
          // Backend ping - respond with pong to keep connection alive
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString(),
            }));
          }
          break;

        case 'pong':
          // Heartbeat response - connection is alive
          break;

        case 'error': {
          const errorMsg = message as ErrorMessage;
          logError('❌ WebSocket server error:', errorMsg.data?.message);
          setConnectionError(errorMsg.data?.message || 'Server error');
          break;
        }

        default:
          logWarn('Unknown WebSocket message type:', message.type);
      }
    } catch (error) {
      logError('Error parsing WebSocket message:', error);
    }
  }, [calculateEnrichedPositionData, solPrice, queuePriceUpdate]);

  /**
   * Setup ping interval
   */
  const setupPingInterval = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }

    pingIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'ping',
          timestamp: new Date().toISOString(),
        }));
      }
    }, pingInterval);
  }, [pingInterval]);

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(() => {
    if (!agentId) {
      setConnectionError('No agent ID provided');
      return;
    }

    if (!accessToken) {
      setConnectionError('No authentication token available');
      return;
    }

    // Use ref-based readyState check instead of isConnected/isConnecting state.
    // State values can be stale in closures (e.g. when called from setTimeout after agent switch),
    // whereas wsRef.current.readyState always reflects the true WebSocket state.
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      log('[WebSocket] ⚠️ Connection already active, skipping connect');
      return;
    }

    // Clean up any stale reference to a closed/closing WebSocket
    if (wsRef.current) {
      wsRef.current = null;
    }

    setIsConnecting(true);
    setConnectionError(null);
    isManualDisconnect.current = false;

    try {
      const wsUrl = getWebSocketUrl(agentId, accessToken);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        log('[WebSocket] ✅ Connection opened');
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionError(null);
        setReconnectAttempts(0);
        reconnectAttemptsRef.current = 0;
        setupPingInterval();
      };

      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        log('[WebSocket] ❌ Connection closed:', event.code, event.reason || 'No reason');

        // Clear the ref immediately so the connect() guard won't be blocked by a stale
        // reference to this closed socket — this is critical for auto-reconnect to work.
        wsRef.current = null;

        setIsConnected(false);
        setIsConnecting(false);

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Request a session refresh so NextAuth can issue a fresh access token.
        // Reconnect attempts below use the token captured in connect()'s closure,
        // which may be expired. The refreshed accessToken triggers the auto-connect
        // effect, which cancels stale timers and connects with the new token.
        if (!isManualDisconnect.current && event.code !== 1000) {
          log('[WebSocket] 🔄 Requesting session refresh for fresh token...');
          updateSessionRef.current?.();
        }

        // Auto-reconnect if not manually disconnected
        // Note: Positions are preserved during automatic disconnects (not cleared)
        // Use ref to get current value (avoids stale closure)
        const currentAttempts = reconnectAttemptsRef.current;
        if (!isManualDisconnect.current && currentAttempts < maxReconnectAttempts) {
          const delay = reconnectInterval * Math.pow(1.5, currentAttempts);
          log(`[WebSocket] 🔄 Reconnecting in ${delay}ms (attempt ${currentAttempts + 1}/${maxReconnectAttempts})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => {
              reconnectAttemptsRef.current = prev + 1;
              return prev + 1;
            });
            connect();
          }, delay);
        } else if (currentAttempts >= maxReconnectAttempts) {
          logError('[WebSocket] ❌ Max reconnection attempts reached - will retry after 5 minutes');
          setConnectionError('Max reconnection attempts reached. Will retry automatically.');
          
          // Reset attempts after 5 minutes to allow retry
          if (reconnectAttemptsResetTimeoutRef.current) {
            clearTimeout(reconnectAttemptsResetTimeoutRef.current);
          }
          reconnectAttemptsResetTimeoutRef.current = setTimeout(() => {
            log('[WebSocket] 🔄 Resetting reconnect attempts after timeout');
            setReconnectAttempts(0);
            reconnectAttemptsRef.current = 0;
            setConnectionError(null);
            // Try to reconnect if conditions are met
            if (!isManualDisconnect.current && agentId && accessToken) {
              connect();
            }
          }, 5 * 60 * 1000); // 5 minutes
        }
      };

      ws.onerror = () => {
        // Browser WebSocket error events never contain useful details (security
        // restriction). The actual close code/reason comes from the onclose event.
        logWarn('[WebSocket] ⚠️ Connection error (see close event for details)');
        setConnectionError('WebSocket connection error');
        setIsConnecting(false);
      };
    } catch (error) {
      logError('Failed to connect to WebSocket:', error);
      setConnectionError(error instanceof Error ? error.message : 'Connection failed');
      setIsConnecting(false);
    }
  }, [agentId, accessToken, maxReconnectAttempts, reconnectInterval, handleMessage, setupPingInterval]);

  /**
   * Disconnect from WebSocket
   * 
   * @param clearPositions - Whether to clear positions (default: true for manual disconnect, false for automatic)
   */
  const disconnect = useCallback((clearPositions: boolean = true) => {
    isManualDisconnect.current = true;

    // Clear all pending updates
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
    
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    pendingPriceUpdatesRef.current.clear();

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (reconnectAttemptsResetTimeoutRef.current) {
      clearTimeout(reconnectAttemptsResetTimeoutRef.current);
      reconnectAttemptsResetTimeoutRef.current = null;
    }

    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    if (wsRef.current) {
      // Remove handlers BEFORE closing to prevent stale error/close events
      // from firing after intentional disconnect (e.g. Strict Mode unmount).
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'Manual disconnect');
      }
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setReconnectAttempts(0);
    
    // Only clear positions on manual disconnect, preserve during automatic disconnects
    if (clearPositions) {
      setPositions([]);
      positionsRef.current = [];
      setLastUpdateTime(null);
      setMessageCount(0);
    }
  }, []);

  /**
   * Reconnect to WebSocket
   * 
   * @param clearPositions - Whether to clear positions (default: false to preserve during reconnection)
   */
  const reconnect = useCallback((clearPositions: boolean = false) => {
    disconnect(clearPositions);
    setTimeout(() => {
      connect();
    }, 1000);
  }, [disconnect, connect]);

  // Unmount cleanup — close the WebSocket but preserve positions in state.
  // Using disconnect(false) is intentional: on true unmount the state is garbage-collected,
  // and on React Strict Mode's simulated unmount/remount the preserved positions avoid a
  // visible flash of empty data while the new connection's initial_data arrives.
  useEffect(() => {
    return () => {
      disconnect(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-connect effect — manages connection lifecycle when agentId or token changes.
  // Handles initial connection, agent switches, and token refreshes.
  useEffect(() => {
    // Clear the manual-disconnect flag: this effect running means we want a connection.
    // Prevents the unmount cleanup (which sets this flag via disconnect()) from blocking
    // reconnection after React Strict Mode's simulated unmount/remount cycle.
    isManualDisconnect.current = false;

    if (!autoConnect || !agentId || !accessToken) {
      return;
    }

    const currentAgentId = agentId;
    const currentToken = accessToken;

    const agentIdChanged = lastAgentIdRef.current !== null && 
                          lastAgentIdRef.current !== currentAgentId;
    const tokenChanged = lastTokenRef.current !== null && 
                        lastTokenRef.current !== currentToken &&
                        lastTokenRef.current !== '';

    // When agent or token changes, cancel all pending timers and reconnect.
    // Stale timers must be cleared even when wsRef.current is null — a dead
    // connection can still have pending reconnect timeouts whose closures
    // reference the old agentId/token, causing competing connections.
    if (agentIdChanged || tokenChanged) {
      log('[WebSocket] 🔄 Agent ID or token changed, performing full cleanup...', {
        agentIdChanged,
        tokenChanged,
        oldAgentId: lastAgentIdRef.current,
        newAgentId: currentAgentId,
      });

      // 1. Cancel stale reconnect/reset timeouts FIRST — prevents old closures from firing
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (reconnectAttemptsResetTimeoutRef.current) {
        clearTimeout(reconnectAttemptsResetTimeoutRef.current);
        reconnectAttemptsResetTimeoutRef.current = null;
      }

      // 2. Reset all reconnect state
      setReconnectAttempts(0);
      reconnectAttemptsRef.current = 0;
      setConnectionError(null);

      // 3. Close active connection if one exists; otherwise clear stale data manually
      if (wsRef.current && 
          (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        disconnect(true);
      } else {
        setPositions([]);
        positionsRef.current = [];
        setLastUpdateTime(null);
        setMessageCount(0);
      }

      // 4. Update refs
      lastAgentIdRef.current = currentAgentId;
      lastTokenRef.current = currentToken;

      // 5. Reconnect with new agent/token after a short delay
      const reconnectTimer = setTimeout(() => {
        isManualDisconnect.current = false;
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          log('[WebSocket] 🔌 Reconnecting with new agent/token...');
          connect();
        }
      }, 300);

      return () => clearTimeout(reconnectTimer);
    }

    // --- No change: initial connection or retry after max attempts ---

    if (lastAgentIdRef.current !== currentAgentId) {
      lastAgentIdRef.current = currentAgentId;
    }
    if (lastTokenRef.current !== currentToken) {
      lastTokenRef.current = currentToken;
    }

    if (reconnectAttempts >= maxReconnectAttempts && !isConnected && !isConnecting && !wsRef.current) {
      log('[WebSocket] 🔄 Resetting reconnect attempts to allow retry');
      setReconnectAttempts(0);
      reconnectAttemptsRef.current = 0;
      setConnectionError(null);
    }

    if (!isConnected && !isConnecting && !wsRef.current && !isManualDisconnect.current) {
      log('[WebSocket] 🔌 Auto-connecting...');
      connect();
    } else if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      log('[WebSocket] ✅ Connection already active, skipping auto-connect');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, accessToken]);

  return {
    // Connection state
    isConnected,
    isConnecting,
    connectionError,
    reconnectAttempts,

    // Data
    positions,
    lastUpdateTime,
    messageCount,

    // Methods
    connect,
    disconnect,
    reconnect,
  };
}

