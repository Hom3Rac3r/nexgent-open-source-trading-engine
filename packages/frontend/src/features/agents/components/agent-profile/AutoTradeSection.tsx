'use client';

/**
 * Auto Trade Section Component
 *
 * When enabled, only tokens in the list are auto-traded: when a position in one
 * of those tokens closes, it is re-purchased immediately. Add token mint addresses
 * to the list; how the position was opened (Manual Trigger or other) does not matter.
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { FormattedNumberInput } from '@/shared/components/ui/formatted-number-input';
import { Switch } from '@/shared/components/ui/switch';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { useFormContext } from 'react-hook-form';
import { RefreshCw, X, Loader2, Info, Coins } from 'lucide-react';
import { useTokenMetadata } from '@/features/agents/hooks/use-token-metadata';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';
import { cn } from '@/shared/utils/cn';

/** Check whether a string looks like a valid Solana mint address (32–44 chars). */
function isLikelyValidAddress(address: string): boolean {
  const trimmed = address.trim();
  return trimmed.length >= 32 && trimmed.length <= 44;
}

/** Shorten an address for display (e.g. "AbCd…xYz1"). */
function formatAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

/** Auto Trade token list and per-token market-cap configuration. */
export function AutoTradeSection() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  const { fetchTokenMetadata } = useTokenMetadata();
  const enabled = form.watch('autoTrade.enabled') ?? false;
  const tokens = form.watch('autoTrade.tokens') ?? [];
  const [newToken, setNewToken] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [isResolvingSymbol, setIsResolvingSymbol] = useState(false);

  const addToken = async () => {
    const trimmed = newToken.trim();
    if (!trimmed) {
      setInputError('Enter a token mint address.');
      return;
    }
    if (!isLikelyValidAddress(trimmed)) {
      setInputError('Token address must be between 32 and 44 characters.');
      return;
    }

    const current = form.getValues('autoTrade.tokens') ?? [];
    const lower = trimmed.toLowerCase();
    if (current.some((t: { address: string }) => t.address.trim().toLowerCase() === lower)) {
      setInputError('That token is already in the list.');
      return;
    }

    setIsResolvingSymbol(true);
    const metadata = await fetchTokenMetadata(trimmed);
    form.setValue(
      'autoTrade.tokens',
      [...current, { address: trimmed, symbol: metadata.symbol, logoUrl: metadata.logoUrl, enabled: false }],
      { shouldDirty: true }
    );
    setIsResolvingSymbol(false);
    setNewToken('');
    setInputError(null);
  };

  const removeToken = (index: number) => {
    const current = form.getValues('autoTrade.tokens') ?? [];
    form.setValue(
      'autoTrade.tokens',
      current.filter((_: { address: string; symbol?: string; logoUrl?: string; enabled: boolean }, i: number) => i !== index),
      { shouldDirty: true }
    );
  };

  const toggleToken = (index: number, tokenEnabled: boolean) => {
    const current = form.getValues('autoTrade.tokens') ?? [];
    const next = current.map((token: { address: string; symbol?: string; logoUrl?: string; enabled: boolean }, i: number) =>
      i === index ? { ...token, enabled: tokenEnabled } : token
    );
    form.setValue('autoTrade.tokens', next, { shouldDirty: true });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Auto Trade
            </CardTitle>
            <CardDescription>
              Add token tiles below, then toggle each tile on/off. New tokens are added in the off state by default.
            </CardDescription>
          </div>
          <FormField
            control={form.control}
            name="autoTrade.enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                <FormLabel htmlFor="auto-trade-enabled" className="text-sm font-normal cursor-pointer">
                  Enable Auto Trade
                </FormLabel>
                <FormControl>
                  <Switch
                    id="auto-trade-enabled"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Global switch controls the entire feature. Per-token switches control which token tiles are eligible when Auto Trade is globally enabled.
        </p>

        <FormField
          control={form.control}
          name="autoTrade.tokens"
          render={() => (
            <FormItem className="space-y-4">
              <FormLabel>Tokens</FormLabel>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Token mint address (e.g. ...pump)"
                  value={newToken}
                  onChange={(e) => {
                    setNewToken(e.target.value);
                    if (inputError) setInputError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (!isResolvingSymbol) void addToken();
                    }
                  }}
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="min-w-[88px] h-10"
                  onClick={() => void addToken()}
                  aria-label="Add token address"
                  disabled={isResolvingSymbol}
                >
                  {isResolvingSymbol ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      Adding
                    </>
                  ) : (
                    'Add'
                  )}
                </Button>
              </div>
              {inputError && <p className="text-xs text-destructive">{inputError}</p>}

              <Separator className="my-2" />

              <Alert className="bg-muted/40">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  Each token has optional market cap bounds. Re-entry and DCA buys will only execute while the token's market cap is within the configured range. Leave empty for no restriction.
                </AlertDescription>
              </Alert>

              {tokens.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  {tokens.map((token: { address: string; symbol?: string; logoUrl?: string; enabled: boolean; marketCapMin?: number; marketCapMax?: number }, index: number) => (
                    <div
                      key={`${token.address}-${index}`}
                      className={cn(
                        'relative rounded-lg border bg-card transition-all hover:shadow-sm',
                        token.enabled
                          ? 'border-foreground/40 bg-foreground/[0.03]'
                          : 'border-border',
                        !enabled && 'opacity-70'
                      )}
                    >
                      <div className="flex items-center gap-3 p-3">
                        {token.logoUrl ? (
                          <div className="h-10 w-10 shrink-0 rounded-lg overflow-hidden border border-border/70 bg-muted/30">
                            <img
                              src={token.logoUrl}
                              alt={`${token.symbol ?? 'Token'} logo`}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'h-10 w-10 shrink-0 rounded-lg flex items-center justify-center border transition-colors',
                              token.enabled
                                ? 'bg-gradient-to-br from-foreground/15 to-foreground/5 border-foreground/25'
                                : 'bg-gradient-to-br from-muted/50 to-muted/30 border-border'
                            )}
                          >
                            <Coins
                              className={cn(
                                'h-5 w-5',
                                token.enabled ? 'text-foreground' : 'text-muted-foreground'
                              )}
                            />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-sm truncate">
                            {token.symbol?.trim() ? token.symbol.toUpperCase() : 'Unknown Token'}
                          </h3>
                          <p className="text-xs text-muted-foreground font-mono" title={token.address}>
                            {formatAddress(token.address)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 ml-1">
                          <Switch
                            checked={token.enabled}
                            onCheckedChange={(checked) => toggleToken(index, checked)}
                            aria-label={`Toggle auto trade for ${token.address}`}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeToken(index)}
                            aria-label={`Remove ${token.address}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>

                        {token.enabled && <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-foreground/80" />}
                      </div>

                      <div className="border-t px-3 pb-3 pt-2">
                        <div className="grid grid-cols-2 gap-2">
                          <FormField
                            control={form.control}
                            name={`autoTrade.tokens.${index}.marketCapMin`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Min Marketcap</FormLabel>
                                <FormControl>
                                  <FormattedNumberInput
                                    value={field.value}
                                    onChange={field.onChange}
                                    placeholder="No min"
                                    className="h-8 text-xs"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`autoTrade.tokens.${index}.marketCapMax`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs">Max Marketcap</FormLabel>
                                <FormControl>
                                  <FormattedNumberInput
                                    value={field.value}
                                    onChange={field.onChange}
                                    placeholder="No max"
                                    className="h-8 text-xs"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tokens.length === 0 && (
                <div className="rounded-md border border-dashed p-6 text-center mt-1">
                  <p className="text-sm text-muted-foreground">
                    No tokens added yet. Add a token address above to create a tile.
                  </p>
                </div>
              )}
            </FormItem>
          )}
        />

      </CardContent>
    </Card>
  );
}
