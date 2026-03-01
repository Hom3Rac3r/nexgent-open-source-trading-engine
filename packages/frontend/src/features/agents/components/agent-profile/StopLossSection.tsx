'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { NumericInput } from '@/shared/components/ui/formatted-number-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { HelpCircle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';
import { useFormContext } from 'react-hook-form';
import { StopLossModeSelector } from './StopLossModeSelector';
import { StrategyExplanation } from './StrategyExplanation';
import { StopLossChart } from './StopLossChart';
import { StopLossExamples } from './StopLossExamples';
import { TrailingLevelsEditor } from './TrailingLevelsEditor';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';
import type { StopLossMode } from '@nexgent/shared';

/**
 * Stop Loss Section Component
 * 
 * Consolidated stop loss configuration with continuous trailing behavior.
 * All modes automatically continue beyond 200% price increase.
 */
export function StopLossSection() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  const stopLossEnabled = form.watch('stopLoss.enabled');
  // Get mode from form, default to 'fixed' if not set
  const stopLossModeValue = form.watch('stopLoss') as any;
  const stopLossMode: 'fixed' | 'exponential' | 'zones' | 'custom' = stopLossModeValue?.mode || 'fixed';
  const trailingLevels = (form.watch('stopLoss.trailingLevels') || []) as Array<{ change: number; stopLoss: number }>;
  const defaultPercentage = form.watch('stopLoss.defaultPercentage') ?? -32;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Stop Loss</CardTitle>
            <CardDescription>
              Configure stop loss settings to protect your positions
            </CardDescription>
          </div>
          <FormField
            control={form.control}
            name="stopLoss.enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                <FormLabel htmlFor="stop-loss-enabled" className="text-sm font-normal cursor-pointer">
                  Enable Stop Loss
                </FormLabel>
                <FormControl>
                  <Switch
                    id="stop-loss-enabled"
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
        {/* Default Stop Loss */}
        <FormField
          control={form.control}
          name="stopLoss.defaultPercentage"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-2">
                <FormLabel>Default Stop Loss</FormLabel>
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Default stop loss help"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <HelpCircle className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[350px]">
                      <p>
                        Starting stop loss that applies before your strategy kicks in. Must be below your purchase price (negative value). 
                        Once the token price reaches a certain increase threshold, your selected stop loss strategy will take over.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <FormControl>
                <NumericInput
                  value={field.value}
                  onChange={(v) => field.onChange(v)}
                  className="max-w-[120px]"
                  disabled={!stopLossEnabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Stop Loss Fields - Only shown when enabled */}
        {stopLossEnabled && (
          <>
            <Separator />

            {/* Curve Function (Mode Selector) */}
            <StopLossModeSelector />

            {/* Strategy Explanation */}
            <StrategyExplanation mode={stopLossMode} />

            {/* Chart Visualization - Always show in same position */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Stop Loss Progression</h4>
              <div className="border rounded-lg p-4 bg-card">
                <StopLossChart
                  mode={stopLossMode}
                  customLevels={stopLossMode === 'custom' ? trailingLevels : undefined}
                  maxChange={300}
                  defaultPercentage={defaultPercentage}
                />
              </div>
              {/* Show examples for non-custom modes */}
              {stopLossMode !== 'custom' && (
                <StopLossExamples mode={stopLossMode} customLevels={undefined} defaultPercentage={defaultPercentage} />
              )}
            </div>

            {/* Custom Mode: Manual Levels Editor - Show below chart */}
            {stopLossMode === 'custom' && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Manual Stop Loss Levels</h4>
                    <Alert className="mb-4">
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        Define discrete stop loss levels manually. Each level defines: when price increases by X%, set stop loss to lock in Y% profit.
                        Levels must be sorted in descending order by price increase percentage.
                      </AlertDescription>
                    </Alert>
                    <TrailingLevelsEditor />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {!stopLossEnabled && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Enable stop loss above to configure your stop loss strategy.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
