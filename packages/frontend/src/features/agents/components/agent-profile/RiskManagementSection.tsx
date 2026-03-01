'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/shared/components/ui/radio-group';
import { Info, Shield, ShieldOff, BarChart3 } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Separator } from '@/shared/components/ui/separator';
import { Label } from '@/shared/components/ui/label';
import { FormattedNumberInput } from '@/shared/components/ui/formatted-number-input';
import { useFormContext } from 'react-hook-form';
import { TokenListEditor } from './TokenListEditor';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';
import type { TokenFilterMode } from '@nexgent/shared';

/**
 * Risk Management Section Component
 *
 * Configures token-related risk controls:
 * - Token filter (blacklist/whitelist)
 * - Token metrics bounds from Jupiter (market cap, liquidity, holder count)
 */
export function RiskManagementSection() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  const tokenFilterMode = (form.watch('signals.tokenFilterMode') || 'none') as TokenFilterMode;

  const handleModeChange = (newMode: string) => {
    const currentMode = form.getValues('signals.tokenFilterMode');

    if (
      (currentMode === 'blacklist' && newMode === 'whitelist') ||
      (currentMode === 'whitelist' && newMode === 'blacklist')
    ) {
      form.setValue('signals.tokenList', [], { shouldDirty: true });
    }

    form.setValue('signals.tokenFilterMode', newMode as TokenFilterMode, { shouldDirty: true });
  };

  return (
    <div className="space-y-6">
      {/* Token Filter Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {tokenFilterMode === 'whitelist' ? (
              <Shield className="h-5 w-5" />
            ) : tokenFilterMode === 'blacklist' ? (
              <ShieldOff className="h-5 w-5" />
            ) : (
              <Shield className="h-5 w-5 text-muted-foreground" />
            )}
            Token Filter
          </CardTitle>
          <CardDescription>
            Control which tokens your agent will trade
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FormField
            control={form.control}
            name="signals.tokenFilterMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Filter Mode</FormLabel>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={handleModeChange}
                    className="grid gap-3"
                  >
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="none" id="rm-filter-none" />
                      <Label htmlFor="rm-filter-none" className="font-normal cursor-pointer">
                        <span className="font-medium">No Filter</span>
                        <span className="text-muted-foreground ml-2">— Accept signals for any token</span>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="blacklist" id="rm-filter-blacklist" />
                      <Label htmlFor="rm-filter-blacklist" className="font-normal cursor-pointer">
                        <span className="font-medium">Blacklist</span>
                        <span className="text-muted-foreground ml-2">— Block specific tokens</span>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="whitelist" id="rm-filter-whitelist" />
                      <Label htmlFor="rm-filter-whitelist" className="font-normal cursor-pointer">
                        <span className="font-medium">Whitelist</span>
                        <span className="text-muted-foreground ml-2">— Only allow specific tokens</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {tokenFilterMode !== 'none' && (
            <>
              <Separator />
              <TokenListEditor mode={tokenFilterMode} />
            </>
          )}

          <Alert className="bg-muted/50">
            <Info className="h-4 w-4" />
            <AlertDescription>
              {tokenFilterMode === 'none' && (
                'Your agent will respond to signals for any token address.'
              )}
              {tokenFilterMode === 'blacklist' && (
                'Your agent will respond to all tokens EXCEPT those in the list above.'
              )}
              {tokenFilterMode === 'whitelist' && (
                'Your agent will ONLY respond to tokens in the list above.'
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Token Metrics (Jupiter) Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5" />
            Token Metrics
          </CardTitle>
          <CardDescription>
            Optional bounds from Jupiter (market cap, liquidity, holder count). Only signals for tokens within these bounds will trigger trades. Leave a field empty for no bound.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="signals.marketCapMin"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Min Market Cap (USD)</FormLabel>
                    <FormControl>
                      <FormattedNumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="No minimum"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="signals.marketCapMax"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Max Market Cap (USD)</FormLabel>
                    <FormControl>
                      <FormattedNumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="No maximum"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="signals.liquidityMin"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Min Liquidity (USD)</FormLabel>
                    <FormControl>
                      <FormattedNumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="No minimum"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="signals.liquidityMax"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Max Liquidity (USD)</FormLabel>
                    <FormControl>
                      <FormattedNumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="No maximum"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="signals.holderCountMin"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Min Holder Count</FormLabel>
                    <FormControl>
                      <FormattedNumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="No minimum"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="signals.holderCountMax"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Max Holder Count</FormLabel>
                    <FormControl>
                      <FormattedNumberInput
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="No maximum"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

          <Alert className="bg-muted/50">
            <Info className="h-4 w-4" />
            <AlertDescription>
              Data is fetched from Jupiter when a signal is received. If metrics are unavailable or a token is not found, agents with any bounds set will not trade on that signal.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
