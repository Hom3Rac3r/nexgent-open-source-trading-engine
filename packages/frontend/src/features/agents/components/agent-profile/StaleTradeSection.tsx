'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/shared/components/ui/form';
import { NumericInput } from '@/shared/components/ui/formatted-number-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { HelpCircle, Info, Clock } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';
import { useFormContext } from 'react-hook-form';
import { StaleTradeExamples } from './StaleTradeExamples';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';

/**
 * Stale Trade Section Component
 * 
 * Configures automatic closing of "stale" positions that have been held
 * for a minimum time and have modest gains that aren't moving significantly.
 */
export function StaleTradeSection() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  const staleTradeEnabled = form.watch('staleTrade.enabled');
  const minHoldTime = form.watch('staleTrade.minHoldTimeMinutes') ?? 60;
  const minProfit = form.watch('staleTrade.minProfitPercent') ?? 1;
  const maxProfit = form.watch('staleTrade.maxProfitPercent') ?? 10;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Stale Trade Auto-Close
            </CardTitle>
            <CardDescription>
              Automatically close positions with modest gains or small losses that aren't moving
            </CardDescription>
          </div>
          <FormField
            control={form.control}
            name="staleTrade.enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                <FormLabel htmlFor="stale-trade-enabled" className="text-sm font-normal cursor-pointer">
                  Enable Stale Trade Config
                </FormLabel>
                <FormControl>
                  <Switch
                    id="stale-trade-enabled"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {staleTradeEnabled ? (
          <>
            {/* Min Hold Time */}
            <FormField
              control={form.control}
              name="staleTrade.minHoldTimeMinutes"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormLabel>Minimum Hold Time (minutes)</FormLabel>
                    <TooltipProvider>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Minimum hold time help"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <HelpCircle className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[300px]">
                          <p>
                            Positions must be held for at least this long before the stale trade 
                            check can trigger. This prevents closing positions too early.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <FormControl>
                    <NumericInput
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      inputMode="numeric"
                      className="max-w-[150px]"
                    />
                  </FormControl>
                  <FormDescription>
                    60 minutes = 1 hour, 120 minutes = 2 hours
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Profit Range */}
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Profit/Loss Range to Trigger Close</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Positions with profit/loss within this range (after minimum hold time) will be closed. 
                  Negative values allow closing losing positions (e.g., -5% to -1%).
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {/* Min Profit Percent */}
                <FormField
                  control={form.control}
                  name="staleTrade.minProfitPercent"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormLabel>Minimum Profit/Loss (%)</FormLabel>
                        <TooltipProvider>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label="Minimum profit/loss help"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <HelpCircle className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              <p>
                                Position must have at least this much profit/loss to be considered 
                                for stale trade closure. Can be negative (e.g., -5% to close losing positions). 
                                Set to 0 to include break-even positions.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <FormControl>
                        <NumericInput
                          value={field.value}
                          onChange={(v) => field.onChange(v)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Max Profit Percent */}
                <FormField
                  control={form.control}
                  name="staleTrade.maxProfitPercent"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormLabel>Maximum Profit/Loss (%)</FormLabel>
                        <TooltipProvider>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label="Maximum profit/loss help"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <HelpCircle className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              <p>
                                Position must have no more than this much profit/loss to be closed 
                                as stale. Can be negative (e.g., -1% to close small losses). 
                                Positions above this will be left to run (or hit stop loss).
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <FormControl>
                        <NumericInput
                          value={field.value}
                          onChange={(v) => field.onChange(v)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* How it works - Examples */}
            <Separator />
            <StaleTradeExamples 
              minHoldTimeMinutes={minHoldTime}
              minProfitPercent={minProfit}
              maxProfitPercent={maxProfit}
            />
          </>
        ) : (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Enable stale trade auto-close to automatically secure modest gains or cut small losses 
              on positions that have been held for a while but aren't moving significantly.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
