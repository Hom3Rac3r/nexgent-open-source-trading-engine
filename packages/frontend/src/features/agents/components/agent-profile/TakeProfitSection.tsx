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
import { HelpCircle, Info, TrendingUp, Sparkles } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';
import { useFormContext } from 'react-hook-form';
import { TakeProfitModeSelector } from './TakeProfitModeSelector';
import { TakeProfitLevelsEditor } from './TakeProfitLevelsEditor';
import { TakeProfitChart } from './TakeProfitChart';
import { TakeProfitExamples } from './TakeProfitExamples';
import { getTakeProfitModeDescription, getTakeProfitLevelsForMode, getMoonBagForMode } from '@nexgent/shared';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';
import type { TakeProfitMode } from '@nexgent/shared';

/**
 * Take-Profit Section Component
 * 
 * Configures partial take-profit settings for automatic profit-taking.
 * When price rises to configured levels, automatically sell a portion of the position.
 * DCA and Take-Profit can both be enabled (append-levels model).
 */
export function TakeProfitSection() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  const takeProfitEnabled = form.watch('takeProfit.enabled');
  const takeProfitMode = (form.watch('takeProfit.mode') || 'moderate') as TakeProfitMode;
  const customLevels = form.watch('takeProfit.levels') || [];
  const moonBag = form.watch('takeProfit.moonBag');

  // Get levels based on mode
  const displayLevels = takeProfitMode === 'custom' ? customLevels : getTakeProfitLevelsForMode(takeProfitMode);
  const displayMoonBag = takeProfitMode === 'custom' ? moonBag : getMoonBagForMode(takeProfitMode);

  // Calculate allocation for custom mode validation
  const totalSellPercent = customLevels.reduce((sum, level) => sum + (level.sellPercent || 0), 0);
  const moonBagPercent = moonBag?.enabled ? (moonBag.retainPercent || 0) : 0;
  const totalAllocation = totalSellPercent + moonBagPercent;
  const exceedsLimit = takeProfitMode === 'custom' && totalAllocation > 100;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Partial Take-Profit
            </CardTitle>
            <CardDescription>
              Lock in gains incrementally as your position rises in value
            </CardDescription>
          </div>
          <FormField
            control={form.control}
            name="takeProfit.enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                <FormLabel htmlFor="takeprofit-enabled" className="text-sm font-normal cursor-pointer">
                  Enable Take-Profit
                </FormLabel>
                <FormControl>
                  <Switch
                    id="takeprofit-enabled"
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
        {/* Take-Profit Fields - Only shown when enabled */}
        {takeProfitEnabled && (
          <>
            {/* Mode Selector */}
            <TakeProfitModeSelector />

            {/* Strategy Explanation */}
            <Alert className="bg-muted/50">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {getTakeProfitModeDescription(takeProfitMode)}
              </AlertDescription>
            </Alert>

            {/* Chart Visualization - Show for all modes */}
            <TakeProfitChart 
              mode={takeProfitMode} 
              customLevels={customLevels}
              moonBag={moonBag}
            />

            {/* Custom Mode: Levels Editor */}
            {takeProfitMode === 'custom' && (
              <>
                <Separator />
                <TakeProfitLevelsEditor />
                
                {/* Moon Bag Configuration for Custom Mode */}
                <Separator />
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-yellow-500" />
                      <span className="font-medium">Moon Bag</span>
                      <TooltipProvider>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="Moon bag help"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <HelpCircle className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[350px]">
                            <p>
                              A &quot;moon bag&quot; is a small portion of your position that you hold indefinitely,
                              in case the token goes &quot;to the moon&quot;. It&apos;s set aside when the trigger 
                              threshold is reached. The moon bag is only sold if stop-loss triggers.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <FormField
                      control={form.control}
                      name="takeProfit.moonBag.enabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  {moonBag?.enabled && (
                    <div className="grid grid-cols-2 gap-4 pl-6">
                      <FormField
                        control={form.control}
                        name="takeProfit.moonBag.triggerPercent"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Trigger At</FormLabel>
                            <FormControl>
                              <div className="flex items-center gap-1">
                                <NumericInput
                                  value={field.value}
                                  onChange={(v) => field.onChange(v)}
                                  className="max-w-[120px]"
                                />
                                <span className="text-muted-foreground text-sm">% gain</span>
                              </div>
                            </FormControl>
                            <FormDescription className="text-xs">
                              When to set aside the moon bag
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="takeProfit.moonBag.retainPercent"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Retain Amount</FormLabel>
                            <FormControl>
                              <div className="flex items-center gap-1">
                                <NumericInput
                                  value={field.value}
                                  onChange={(v) => field.onChange(v)}
                                  className="max-w-[120px]"
                                />
                                <span className="text-muted-foreground text-sm">%</span>
                              </div>
                            </FormControl>
                            <FormDescription className="text-xs">
                              Percentage of original position to keep
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  {/* Allocation exceeded alert in moon bag section */}
                  {exceedsLimit && moonBag?.enabled && (
                    <Alert className="border-red-500 bg-red-500/10 text-red-500 ml-6">
                      <AlertDescription>
                        ⚠️ <strong>Total allocation exceeds 100%!</strong> Reduce moon bag retain amount 
                        or take-profit sell percentages. Current: {totalAllocation}%
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </>
            )}

            {/* Examples - Show for all modes */}
            <Separator />
            <TakeProfitExamples
              mode={takeProfitMode}
              customLevels={customLevels}
              moonBag={displayMoonBag}
            />
          </>
        )}

        {!takeProfitEnabled && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Enable Take-Profit to automatically lock in gains as your positions rise.
              Set multiple price targets and sell portions of your position at each level,
              securing profits while maintaining exposure to further upside.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
