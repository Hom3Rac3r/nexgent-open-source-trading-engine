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
import { HelpCircle, Info, TrendingDown } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Separator } from '@/shared/components/ui/separator';
import { Switch } from '@/shared/components/ui/switch';
import { useFormContext } from 'react-hook-form';
import { DCAModeSelector } from './DCAModeSelector';
import { DCALevelsEditor } from './DCALevelsEditor';
import { DCAExamples } from './DCAExamples';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';
import type { DCAMode } from '@nexgent/shared';

/**
 * DCA Section Component
 * 
 * Configures Dollar Cost Averaging (DCA) settings for automatic position averaging.
 * When price drops to configured levels, automatically buy more to lower average cost.
 */
export function DCASection() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  const dcaEnabled = form.watch('dca.enabled');
  const dcaMode = (form.watch('dca.mode') || 'moderate') as DCAMode;
  const customLevels = form.watch('dca.levels') || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5" />
              Dollar Cost Averaging (DCA)
            </CardTitle>
            <CardDescription>
              Automatically buy more when price drops to lower your average cost
            </CardDescription>
          </div>
          <FormField
            control={form.control}
            name="dca.enabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                <FormLabel htmlFor="dca-enabled" className="text-sm font-normal cursor-pointer">
                  Enable DCA
                </FormLabel>
                <FormControl>
                  <Switch
                    id="dca-enabled"
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
        {/* Cooldown - at top like Default Stop Loss */}
        <FormField
          control={form.control}
          name="dca.cooldownSeconds"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-2">
                <FormLabel>Cooldown (seconds)</FormLabel>
                <TooltipProvider>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Cooldown help"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <HelpCircle className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[350px]">
                      <p>
                        Minimum time between DCA buys. Prevents rapid-fire buys during 
                        volatile price swings. A new DCA will not trigger until at least 
                        this much time has passed since the last DCA buy.
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
                  className="max-w-[120px]"
                  disabled={!dcaEnabled}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* DCA Fields - Only shown when enabled */}
        {dcaEnabled && (
          <>
            <Separator />

            {/* DCA Strategy Selector */}
            <DCAModeSelector />

            {/* Strategy Explanation */}
            <Alert className="bg-muted/50">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {dcaMode === 'aggressive' && 
                  '3 levels at -10% drop, each buying 100% more. After each buy, the average price updates, so the next -10% is measured from the new average. This is the opposite of stop loss — instead of selling at a loss, you buy more at lower prices. Best for traders who want to maximize position size during dips.'
                }
                {dcaMode === 'moderate' && 
                  '2 levels at -20% drop, each buying 75% more. After each buy, the average price updates, so the next -20% is measured from the new average. This is the opposite of stop loss — instead of selling at a loss, you buy more at lower prices. Balanced approach that provides good cost averaging without excessive risk exposure.'
                }
                {dcaMode === 'conservative' && 
                  'Single level at -20% drop, buying 100% more. This is the opposite of stop loss — instead of selling at a loss, you buy more at lower prices. More cautious approach that only triggers on significant price drops, preserving capital for larger opportunities.'
                }
                {dcaMode === 'custom' && 
                  'Manually define discrete DCA levels at specific price drop points. When your position drops to a DCA level, the agent will automatically buy more tokens to lower your average purchase price. This is the opposite of stop loss — instead of selling at a loss, you buy more at lower prices. Full control over exactly when and how much to buy. Best for traders who want precise control over their DCA behavior.'
                }
              </AlertDescription>
            </Alert>

            {/* DCA Examples - Only for non-custom modes */}
            {dcaMode !== 'custom' && (
              <DCAExamples mode={dcaMode} />
            )}

            {/* Custom Mode: Manual Levels Editor */}
            {dcaMode === 'custom' && (
              <>
                <Separator />
                <DCALevelsEditor />
              </>
            )}

            {/* DCA Examples - For custom mode, show after levels editor */}
            {dcaMode === 'custom' && customLevels.length > 0 && (
              <DCAExamples mode={dcaMode} customLevels={customLevels} />
            )}
          </>
        )}

        {!dcaEnabled && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Enable DCA to automatically buy more when your positions drop in value. 
              This strategy can help lower your average cost basis and potentially 
              recover losses faster when prices rebound.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
