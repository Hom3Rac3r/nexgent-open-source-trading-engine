/**
 * Token Metadata Service
 * 
 * Fetches token metadata (decimals, symbol, etc.) from Solana blockchain
 */

import { Connection, PublicKey } from '@solana/web3.js';
import logger from '@/infrastructure/logging/logger.js';

/**
 * Token Metadata Service Error
 */
export class TokenMetadataServiceError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TokenMetadataServiceError';
  }
}

/**
 * Token metadata information
 */
export interface TokenMetadata {
  address: string;
  decimals: number;
  symbol?: string;
  name?: string;
}

/**
 * Token Metadata Service
 * 
 * Singleton service for fetching token metadata from Solana blockchain
 */
class TokenMetadataService {
  private connection: Connection | null = null;
  private readonly SOL_DECIMALS = 9;
  private readonly SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  private readonly MAX_RETRIES = 2;
  private readonly RETRY_DELAY_MS = 500;
  private decimalsCache: Map<string, number> = new Map();

  /**
   * Initialize the service with Solana RPC connection
   */
  initialize(rpcUrl?: string): void {
    if (this.connection) {
      return; // Already initialized
    }

    const url = rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(url, 'confirmed');
    
    // Pre-populate SOL decimals
    this.decimalsCache.set(this.SOL_MINT_ADDRESS, this.SOL_DECIMALS);
    
    logger.info({ rpcUrl: url }, 'TokenMetadataService initialized');
  }

  /**
   * Get token decimals from on-chain mint account data.
   *
   * Retries up to {@link MAX_RETRIES} times on transient RPC failures before
   * throwing. Never falls back to a default — using wrong decimals would cause
   * catastrophic mis-pricing of trades.
   *
   * @param tokenAddress - Token mint address
   * @returns Token decimals (number of decimal places)
   * @throws TokenMetadataServiceError if decimals cannot be fetched after retries
   */
  async getTokenDecimals(tokenAddress: string): Promise<number> {
    // Check cache first
    if (this.decimalsCache.has(tokenAddress)) {
      return this.decimalsCache.get(tokenAddress)!;
    }

    // SOL has fixed decimals — this is a Solana protocol constant
    if (tokenAddress.toLowerCase() === this.SOL_MINT_ADDRESS.toLowerCase()) {
      this.decimalsCache.set(tokenAddress, this.SOL_DECIMALS);
      return this.SOL_DECIMALS;
    }

    if (!this.connection) {
      this.initialize();
    }

    return this.fetchDecimalsWithRetry(tokenAddress);
  }

  /**
   * Fetch decimals from the on-chain mint account with retry logic.
   *
   * Retries absorb transient RPC errors (network blips, rate limits). If all
   * attempts fail the error propagates so callers can abort the trade safely.
   */
  private async fetchDecimalsWithRetry(tokenAddress: string): Promise<number> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const decimals = await this.fetchDecimalsFromChain(tokenAddress);

        // Only cache a value we actually read from chain
        this.decimalsCache.set(tokenAddress, decimals);
        return decimals;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(
          { tokenAddress, attempt, maxRetries: this.MAX_RETRIES, error: lastError.message },
          'Token decimals fetch attempt failed'
        );

        // Wait before retrying (skip delay on final attempt)
        if (attempt < this.MAX_RETRIES) {
          await this.delay(this.RETRY_DELAY_MS);
        }
      }
    }

    // All retries exhausted — throw so the trade is aborted rather than
    // proceeding with potentially wrong decimals
    throw new TokenMetadataServiceError(
      `Failed to fetch decimals for token ${tokenAddress} after ${this.MAX_RETRIES} attempts: ${lastError?.message}`,
      'DECIMALS_FETCH_FAILED',
      { tokenAddress, lastError: lastError?.message }
    );
  }

  /**
   * Read decimals from the on-chain SPL Token mint account.
   *
   * @see https://spl.solana.com/token#finding-a-token-account
   */
  private async fetchDecimalsFromChain(tokenAddress: string): Promise<number> {
    const mintPublicKey = new PublicKey(tokenAddress);

    const accountInfo = await this.connection!.getAccountInfo(mintPublicKey);

    if (!accountInfo) {
      throw new Error(`Token account not found: ${tokenAddress}`);
    }

    // Mint account data structure:
    // - Bytes 0-35: mint authority (Pubkey, 32 bytes) + option flag (1 byte) + padding (2 bytes)
    // - Bytes 36-43: supply (u64, 8 bytes)
    // - Byte  44:    decimals (u8, 1 byte)
    // - Bytes 45-76: is_initialized + freeze_authority + option flag + padding
    if (accountInfo.data.length < 45) {
      throw new Error(`Invalid mint account data length: ${accountInfo.data.length}`);
    }

    return accountInfo.data[44];
  }

  /** Simple async delay helper for retry back-off. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert amount from smallest unit to token amount
   * 
   * @param amount - Amount in smallest unit (e.g., lamports)
   * @param tokenAddress - Token mint address
   * @returns Amount in token units
   */
  async convertFromSmallestUnit(amount: number, tokenAddress: string): Promise<number> {
    const decimals = await this.getTokenDecimals(tokenAddress);
    return amount / Math.pow(10, decimals);
  }

  /**
   * Convert amount from token units to smallest unit
   * 
   * @param amount - Amount in token units
   * @param tokenAddress - Token mint address
   * @returns Amount in smallest unit (e.g., lamports)
   */
  async convertToSmallestUnit(amount: number, tokenAddress: string): Promise<number> {
    const decimals = await this.getTokenDecimals(tokenAddress);
    return Math.floor(amount * Math.pow(10, decimals));
  }

  /**
   * Clear the decimals cache
   */
  clearCache(): void {
    this.decimalsCache.clear();
  }
}

export const tokenMetadataService = new TokenMetadataService();

