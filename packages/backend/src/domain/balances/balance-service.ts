/**
 * Balance Service
 * 
 * Handles automatic balance updates based on transactions.
 * Ensures balances are updated atomically with transaction creation/updates.
 */

import { Decimal } from '@prisma/client/runtime/library';
import { TransactionType, Prisma } from '@prisma/client';
import type { IBalanceRepository } from './balance.repository.js';
import { BalanceRepository } from '@/infrastructure/database/repositories/balance.repository.js';
import { redisBalanceService } from '@/infrastructure/cache/redis-balance-service.js';

/**
 * Tolerance for balance validation to account for floating-point precision issues.
 * This allows for tiny rounding differences (e.g., 0.000000005) that can occur
 * due to decimal arithmetic and storage precision.
 */
const BALANCE_TOLERANCE = new Decimal('0.00000001'); // 1e-8

/**
 * Balance delta calculation result
 */
export interface BalanceDelta {
  inputToken: {
    tokenAddress: string;
    tokenSymbol: string;
    delta: Decimal; // Positive for increases, negative for decreases
    requiresValidation: boolean; // Whether to check sufficient balance
    mustExist: boolean; // Whether balance must exist before transaction
  };
  outputToken?: {
    tokenAddress: string;
    tokenSymbol: string;
    delta: Decimal; // Always positive (incoming tokens)
    requiresValidation: boolean; // Always false for output tokens
    mustExist: boolean; // Always false (will be created if needed)
  };
}

/**
 * Balance update error
 */
export class BalanceError extends Error {
  constructor(
    message: string,
    public readonly currentBalance?: string,
    public readonly requiredAmount?: string,
    public readonly tokenAddress?: string,
    public readonly tokenSymbol?: string
  ) {
    super(message);
    this.name = 'BalanceError';
  }
}

/**
 * Balance Service
 * 
 * Provides methods for updating balances based on transactions.
 */
export class BalanceService {
  constructor(private readonly balanceRepo: IBalanceRepository) { }

  /**
   * Calculate balance deltas for a transaction
   * 
   * @param transactionType - Type of transaction
   * @param inputMint - Input token address
   * @param inputSymbol - Input token symbol
   * @param inputAmount - Input token amount
   * @param outputMint - Output token address (for swaps)
   * @param outputSymbol - Output token symbol (for swaps)
   * @param outputAmount - Output token amount (for swaps)
   * @returns Balance delta information
   * @throws Error if required fields are missing
   */
  calculateBalanceDelta(
    transactionType: TransactionType,
    inputMint: string | null | undefined,
    inputSymbol: string | null | undefined,
    inputAmount: Decimal | null | undefined,
    outputMint?: string | null | undefined,
    outputSymbol?: string | null | undefined,
    outputAmount?: Decimal | null | undefined
  ): BalanceDelta {
    // Validate input token is present for all transaction types
    if (!inputMint || !inputSymbol || !inputAmount) {
      throw new Error(
        `Input token (mint, symbol, amount) is required for ${transactionType} transactions`
      );
    }

    // Validate input amount is positive
    if (inputAmount.lte(0)) {
      throw new Error('Input amount must be positive');
    }

    switch (transactionType) {
      case TransactionType.DEPOSIT:
        return {
          inputToken: {
            tokenAddress: inputMint,
            tokenSymbol: inputSymbol,
            delta: inputAmount, // Positive (increase)
            requiresValidation: false, // Deposits always allowed
            mustExist: false, // Will be created if doesn't exist
          },
        };

      case TransactionType.SWAP:
        // Validate output token is present for swaps
        if (!outputMint || !outputSymbol || !outputAmount) {
          throw new Error('Output token (mint, symbol, amount) is required for SWAP transactions');
        }

        // Validate output amount is positive
        if (outputAmount.lte(0)) {
          throw new Error('Output amount must be positive');
        }

        return {
          inputToken: {
            tokenAddress: inputMint,
            tokenSymbol: inputSymbol,
            delta: inputAmount.negated(), // Negative (decrease)
            requiresValidation: true, // Must check sufficient balance
            mustExist: true, // Input balance must exist
          },
          outputToken: {
            tokenAddress: outputMint,
            tokenSymbol: outputSymbol,
            delta: outputAmount, // Positive (increase)
            requiresValidation: false, // Output always allowed
            mustExist: false, // Will be created if doesn't exist
          },
        };

      case TransactionType.BURN:
        return {
          inputToken: {
            tokenAddress: inputMint,
            tokenSymbol: inputSymbol,
            delta: inputAmount.negated(), // Negative (decrease)
            requiresValidation: true, // Must check sufficient balance
            mustExist: true, // Balance must exist
          },
        };

      default:
        throw new Error(`Unsupported transaction type: ${transactionType}`);
    }
  }

  /**
   * Validate sufficient balance for a transaction
   * 
   * @param walletAddress - Wallet address
   * @param tokenAddress - Token address
   * @param requiredAmount - Required amount (as Decimal)
   * @param tx - Prisma transaction client
   * @returns Current balance as Decimal
   * @throws BalanceError if insufficient balance
   */
  async validateSufficientBalance(
    walletAddress: string,
    tokenAddress: string,
    requiredAmount: Decimal,
    tx?: Prisma.TransactionClient
  ): Promise<Decimal> {
    // Note: This method uses DB for validation since agentId is not available here.
    // Redis balance keys require agentId, but callers only pass walletAddress.
    // This is acceptable because upsertBalance updates Redis synchronously, so DB stays in sync.

    // Fetch balance from DB
    // Note: If we are in async mode, 'tx' might not be a real transaction or might be omitted.
    // If 'tx' is missing, we just read.
    const balance = await this.balanceRepo.findByWalletAddressAndTokenAddress(walletAddress, tokenAddress, tx);

    if (!balance) {
      throw new BalanceError(
        'Balance not found for token',
        undefined,
        requiredAmount.toString(),
        tokenAddress
      );
    }

    const currentBalance = new Decimal(balance.balance);

    // Check sufficient balance with tolerance for floating-point precision
    // Allow tiny differences (e.g., 0.000000005) that can occur due to rounding
    // We consider balance sufficient if: currentBalance >= requiredAmount - tolerance
    const minimumRequired = requiredAmount.minus(BALANCE_TOLERANCE);
    if (currentBalance.lt(minimumRequired)) {
      // Balance is insufficient (beyond tolerance threshold)
      throw new BalanceError(
        'Insufficient balance',
        currentBalance.toString(),
        requiredAmount.toString(),
        tokenAddress,
        balance.tokenSymbol
      );
    }

    return currentBalance;
  }

  /**
   * Lock a balance row for update (prevents concurrent modifications)
   * 
   * @param walletAddress - Wallet address
   * @param tokenAddress - Token address
   * @param tx - Prisma transaction client
   */
  async lockBalanceRow(
    walletAddress: string,
    tokenAddress: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (tx) {
      await this.balanceRepo.lockRow(walletAddress, tokenAddress, tx);
    }
  }

  /**
   * Upsert a balance record (create or update)
   * 
   * @param walletAddress - Wallet address
   * @param agentId - Agent ID
   * @param tokenAddress - Token address
   * @param tokenSymbol - Token symbol
   * @param delta - Balance change (positive or negative Decimal)
   * @param initialAmount - Initial amount if creating new balance (optional)
   * @param tx - Optional Prisma transaction client (deprecated in async flow)
   * @returns Updated balance as Decimal
   */
  async upsertBalance(
    walletAddress: string,
    agentId: string,
    tokenAddress: string,
    tokenSymbol: string,
    delta: Decimal,
    initialAmount: Decimal | null,
    tx?: Prisma.TransactionClient
  ): Promise<Decimal> {
    // 1. Try to find existing balance in Redis first
    let existingBalance = await redisBalanceService.getBalance(agentId, walletAddress, tokenAddress);

    // 2. If not in Redis, try DB (and cache if found)
    if (!existingBalance) {
      const dbBalance = await this.balanceRepo.findByWalletAddressAndTokenAddress(walletAddress, tokenAddress, tx);
      if (dbBalance) {
        existingBalance = {
          id: dbBalance.id,
          agentId: dbBalance.agentId,
          walletAddress: dbBalance.walletAddress,
          tokenAddress: dbBalance.tokenAddress,
          tokenSymbol: dbBalance.tokenSymbol,
          balance: dbBalance.balance,
          lastUpdated: dbBalance.lastUpdated
        };
        // Cache it
        await redisBalanceService.setBalance(existingBalance);
      }
    }

    if (existingBalance) {
      // Update existing balance
      const currentBalance = new Decimal(existingBalance.balance);
      let newBalance = currentBalance.plus(delta);

      // Handle floating-point precision: if balance would be slightly negative (within tolerance),
      // set it to zero instead of throwing an error. This accounts for rounding differences.
      if (newBalance.lt(0)) {
        // Check if the negative amount is within tolerance (rounding error)
        if (newBalance.abs().lte(BALANCE_TOLERANCE)) {
          // Within tolerance, set to zero (effectively using all available balance)
          newBalance = new Decimal(0);
        } else {
          // Beyond tolerance, this is a real insufficient balance error
          throw new BalanceError(
            'Balance cannot be negative',
            currentBalance.toString(),
            delta.abs().toString(),
            tokenAddress,
            tokenSymbol
          );
        }
      }

      // Write-Through: Persist by unique wallet+token key instead of cached row ID.
      // This prevents P2025 failures when Redis has a stale balance ID after wallet reset
      // or concurrent delete/recreate flows.
      const dbBalance = await this.balanceRepo.upsert(
        walletAddress,
        agentId,
        tokenAddress,
        tokenSymbol,
        newBalance.toString(),
        tx
      );

      // Update Redis cache (only if not in transaction - if in transaction, caller updates after commit)
      if (!tx) {
        const updatedBalance = {
          id: dbBalance.id,
          agentId: dbBalance.agentId,
          walletAddress: dbBalance.walletAddress,
          tokenAddress: dbBalance.tokenAddress,
          tokenSymbol: dbBalance.tokenSymbol,
          balance: dbBalance.balance,
          lastUpdated: dbBalance.lastUpdated
        };
        await redisBalanceService.setBalance(updatedBalance);
      }

      return newBalance;
    } else {
      // Create new balance
      const initialBalance = initialAmount || (delta.gt(0) ? delta : new Decimal(0));

      // Ensure initial balance is not negative
      if (initialBalance.lt(0)) {
        throw new BalanceError(
          'Cannot create balance with negative amount',
          '0',
          initialBalance.abs().toString(),
          tokenAddress,
          tokenSymbol
        );
      }

      // Write-Through: Create in DB first (source of truth)
      const dbBalance = await this.balanceRepo.create({
        agent: { connect: { id: agentId } },
        wallet: { connect: { walletAddress: walletAddress } },
        tokenAddress,
        tokenSymbol,
        balance: initialBalance.toString(),
      }, tx);

      // Update Redis cache (only if not in transaction - if in transaction, caller updates after commit)
      if (!tx) {
        const newBalance = {
          id: dbBalance.id,
          agentId: dbBalance.agentId,
          walletAddress: dbBalance.walletAddress,
          tokenAddress: dbBalance.tokenAddress,
          tokenSymbol: dbBalance.tokenSymbol,
          balance: dbBalance.balance,
          lastUpdated: dbBalance.lastUpdated
        };
        await redisBalanceService.setBalance(newBalance);
      }

      return initialBalance;
    }
  }

  /**
   * Update balances from a transaction
   * 
   * This is the main method that orchestrates balance updates.
   * Should be called within a database transaction.
   * 
   * @param walletAddress - Wallet address
   * @param agentId - Agent ID
   * @param transactionType - Type of transaction
   * @param inputMint - Input token address
   * @param inputSymbol - Input token symbol
   * @param inputAmount - Input token amount (as Decimal)
   * @param outputMint - Output token address (for swaps)
   * @param outputSymbol - Output token symbol (for swaps)
   * @param outputAmount - Output token amount (for swaps, as Decimal)
   * @param tx - Prisma transaction client
   * @returns Updated balances (input and output if applicable)
   * @throws BalanceError if validation fails
   */
  async updateBalancesFromTransaction(
    walletAddress: string,
    agentId: string,
    transactionType: TransactionType,
    inputMint: string | null | undefined,
    inputSymbol: string | null | undefined,
    inputAmount: Decimal | null | undefined,
    outputMint: string | null | undefined,
    outputSymbol: string | null | undefined,
    outputAmount: Decimal | null | undefined,
    tx?: Prisma.TransactionClient
  ): Promise<{
    inputBalance: Decimal;
    outputBalance?: Decimal;
  }> {
    // Calculate balance deltas
    const balanceDelta = this.calculateBalanceDelta(
      transactionType,
      inputMint,
      inputSymbol,
      inputAmount,
      outputMint,
      outputSymbol,
      outputAmount
    );

    // Lock and validate input balance if needed
    if (balanceDelta.inputToken.requiresValidation || balanceDelta.inputToken.mustExist) {
      await this.lockBalanceRow(walletAddress, balanceDelta.inputToken.tokenAddress, tx);

      if (balanceDelta.inputToken.requiresValidation) {
        // Validate sufficient balance (delta is negative, so we need abs)
        await this.validateSufficientBalance(
          walletAddress,
          balanceDelta.inputToken.tokenAddress,
          balanceDelta.inputToken.delta.abs(),
          tx
        );
      } else if (balanceDelta.inputToken.mustExist) {
        // Just check balance exists
        const balance = await this.balanceRepo.findByWalletAddressAndTokenAddress(walletAddress, balanceDelta.inputToken.tokenAddress, tx);

        if (!balance) {
          throw new BalanceError(
            'Balance not found for token',
            undefined,
            undefined,
            balanceDelta.inputToken.tokenAddress,
            balanceDelta.inputToken.tokenSymbol
          );
        }
      }
    }

    // Update input balance
    const inputBalance = await this.upsertBalance(
      walletAddress,
      agentId,
      balanceDelta.inputToken.tokenAddress,
      balanceDelta.inputToken.tokenSymbol,
      balanceDelta.inputToken.delta,
      balanceDelta.inputToken.delta.gt(0) ? balanceDelta.inputToken.delta : null,
      tx
    );

    // Update output balance if present (for swaps)
    let outputBalance: Decimal | undefined;
    if (balanceDelta.outputToken) {
      // Lock output balance row (even though we're creating, lock for consistency)
      await this.lockBalanceRow(walletAddress, balanceDelta.outputToken.tokenAddress, tx);

      outputBalance = await this.upsertBalance(
        walletAddress,
        agentId,
        balanceDelta.outputToken.tokenAddress,
        balanceDelta.outputToken.tokenSymbol,
        balanceDelta.outputToken.delta,
        balanceDelta.outputToken.delta, // Initial amount is the delta (positive)
        tx
      );
    }

    return {
      inputBalance,
      outputBalance,
    };
  }

  /**
   * Recalculate balance deltas for transaction update
   * 
   * Compares old and new transaction values to determine balance changes.
   * 
   * @param oldTransaction - Original transaction values
   * @param newTransaction - Updated transaction values
   * @returns Balance deltas to apply
   */
  calculateUpdateDeltas(
    oldTransaction: {
      transactionType: TransactionType;
      inputMint: string | null;
      inputAmount: Decimal | null;
      outputMint: string | null;
      outputAmount: Decimal | null;
    },
    newTransaction: {
      transactionType: TransactionType;
      inputMint: string | null;
      inputSymbol: string | null;
      inputAmount: Decimal | null;
      outputMint: string | null;
      outputSymbol: string | null;
      outputAmount: Decimal | null;
    }
  ): {
    inputToken?: {
      tokenAddress: string;
      tokenSymbol: string;
      delta: Decimal;
      requiresValidation: boolean;
      mustExist: boolean;
    };
    outputToken?: {
      tokenAddress: string;
      tokenSymbol: string;
      delta: Decimal;
      requiresValidation: boolean;
      mustExist: boolean;
    };
    oldInputToken?: {
      tokenAddress: string;
      delta: Decimal; // Reversal delta (opposite of original)
    };
    oldOutputToken?: {
      tokenAddress: string;
      delta: Decimal; // Reversal delta (opposite of original)
    };
  } {
    const deltas: {
      inputToken?: {
        tokenAddress: string;
        tokenSymbol: string;
        delta: Decimal;
        requiresValidation: boolean;
        mustExist: boolean;
      };
      outputToken?: {
        tokenAddress: string;
        tokenSymbol: string;
        delta: Decimal;
        requiresValidation: boolean;
        mustExist: boolean;
      };
      oldInputToken?: {
        tokenAddress: string;
        delta: Decimal;
      };
      oldOutputToken?: {
        tokenAddress: string;
        delta: Decimal;
      };
    } = {};

    // Calculate reversal for old transaction
    if (oldTransaction.inputMint && oldTransaction.inputAmount) {
      const oldDelta = this.calculateBalanceDelta(
        oldTransaction.transactionType,
        oldTransaction.inputMint,
        null, // Symbol not needed for reversal
        oldTransaction.inputAmount,
        oldTransaction.outputMint,
        null, // Symbol not needed
        oldTransaction.outputAmount
      );

      // Reverse the old input delta
      deltas.oldInputToken = {
        tokenAddress: oldDelta.inputToken.tokenAddress,
        delta: oldDelta.inputToken.delta.negated(), // Reverse
      };

      // Reverse the old output delta if present
      if (oldDelta.outputToken) {
        deltas.oldOutputToken = {
          tokenAddress: oldDelta.outputToken.tokenAddress,
          delta: oldDelta.outputToken.delta.negated(), // Reverse
        };
      }
    }

    // Calculate new transaction delta
    if (newTransaction.inputMint && newTransaction.inputSymbol && newTransaction.inputAmount) {
      const newDelta = this.calculateBalanceDelta(
        newTransaction.transactionType,
        newTransaction.inputMint,
        newTransaction.inputSymbol,
        newTransaction.inputAmount,
        newTransaction.outputMint,
        newTransaction.outputSymbol,
        newTransaction.outputAmount
      );

      deltas.inputToken = newDelta.inputToken;

      if (newDelta.outputToken) {
        deltas.outputToken = newDelta.outputToken;
      }
    }

    return deltas;
  }
}

// Export singleton instance
export const balanceService = new BalanceService(new BalanceRepository());
