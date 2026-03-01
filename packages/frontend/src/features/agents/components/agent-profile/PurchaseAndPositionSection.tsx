'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { useFormContext, useWatch } from 'react-hook-form';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';
import type { UseFormReturn } from 'react-hook-form';
import { NumericInput } from '@/shared/components/ui/formatted-number-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip';
import { HelpCircle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Checkbox } from '@/shared/components/ui/checkbox';

function PositionCalculatorForm({ form }: { form: UseFormReturn<AgentTradingConfigFormValues> }) {
  const { errors } = form.formState;
  const thresholds = useWatch({
    control: form.control,
    name: 'positionCalculator.solBalanceThresholds',
    defaultValue: { minimum: 0.2, medium: 5, large: 10 },
  });
  const minimum = Number(thresholds?.minimum ?? 0.2);
  const medium = Number(thresholds?.medium ?? 5);
  const largeVal = Number(thresholds?.large ?? 10);

  const smallRange = `${minimum} – ${medium}`;
  const mediumRange = `${medium} – ${largeVal}`;
  const largeRange = `${largeVal}+`;

  return (
    <div className="space-y-6">
      {/* Boundary inputs */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Balance boundaries (SOL)</h4>
        <p className="text-sm text-muted-foreground">
          Small = from first value until second. Medium = from second until third. Large = third and above.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <FormField
            control={form.control}
            name="positionCalculator.solBalanceThresholds.minimum"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Small from (SOL)</FormLabel>
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
          <FormField
            control={form.control}
            name="positionCalculator.solBalanceThresholds.medium"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Medium from (SOL)</FormLabel>
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
          <FormField
            control={form.control}
            name="positionCalculator.solBalanceThresholds.large"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Large from (SOL)</FormLabel>
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
        {errors.positionCalculator?.solBalanceThresholds?.message && (
          <p className="text-sm text-destructive">
            {errors.positionCalculator.solBalanceThresholds.message}
          </p>
        )}
      </div>

      {/* Dynamic range summary */}
      <div className="rounded-lg border bg-muted/30 px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Balance ranges
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span><strong>Small:</strong> {smallRange} SOL</span>
          <span><strong>Medium:</strong> {mediumRange} SOL</span>
          <span><strong>Large:</strong> {largeRange} SOL</span>
        </div>
      </div>

      {/* Position sizes by category */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Position size (min/max SOL) per range</h4>
        <div className="grid gap-4">
          <CategoryRow form={form} category="small" rangeLabel={`When balance: ${smallRange} SOL`} />
          <CategoryRow form={form} category="medium" rangeLabel={`When balance: ${mediumRange} SOL`} />
          <CategoryRow form={form} category="large" rangeLabel={`When balance: ${largeRange} SOL`} />
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  form,
  category,
  rangeLabel,
}: {
  form: UseFormReturn<AgentTradingConfigFormValues>;
  category: 'small' | 'medium' | 'large';
  rangeLabel: string;
}) {
  const { errors } = form.formState;
  const categoryErrors = errors.positionCalculator?.positionSizes?.[category];
  const sizeErrorMessage = categoryErrors?.message ?? categoryErrors?.root?.message;

  return (
    <div className="grid gap-4 md:grid-cols-3 border rounded-lg p-4 items-center">
      <div>
        <span className="text-sm font-medium capitalize">{category}</span>
        <p className="text-xs text-muted-foreground mt-0.5">{rangeLabel}</p>
      </div>
      <FormField
        control={form.control}
        name={`positionCalculator.positionSizes.${category}.min`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Min (SOL)</FormLabel>
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
      <FormField
        control={form.control}
        name={`positionCalculator.positionSizes.${category}.max`}
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-xs">Max (SOL)</FormLabel>
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
      {sizeErrorMessage && (
        <p className="text-sm text-destructive col-span-full -mt-2">{sizeErrorMessage}</p>
      )}
    </div>
  );
}

/**
 * Purchase & Position Section Component
 * 
 * Combines Purchase Limits and Position Calculator in one tab.
 * Uses form context from parent Form component.
 */
export function PurchaseAndPositionSection() {
  // Form context is provided by parent Form component
  const form = useFormContext<AgentTradingConfigFormValues>();
  
  return (
    <div className="space-y-6">
      {/* Slippage Threshold Subsection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Slippage threshold</CardTitle>
          <CardDescription>
            Maximum acceptable price impact for swaps
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-muted/50">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Slippage occurs when your trade size is large compared to available liquidity, causing you to
              receive fewer tokens than expected. If a swap quote exceeds this threshold, the system will
              retry with a smaller amount.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="purchaseLimits.maxPriceImpact"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormLabel>Max Slippage (%)</FormLabel>
                    <TooltipProvider>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Slippage help"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <HelpCircle className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[300px]">
                          <p>
                            Maximum acceptable slippage percentage. If a swap quote exceeds this threshold,
                            the system will automatically retry with a smaller purchase amount. If all retries
                            fail, the trade will be rejected.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <FormControl>
                    {/*
                     * Form stores maxPriceImpact as 0–1 (e.g. 0.05); user sees percentage (e.g. 5).
                     * fallbackValue 5 (5%) restores default when cleared so the field cannot be left empty.
                     */}
                    <NumericInput
                      value={field.value != null ? field.value * 100 : undefined}
                      onChange={(v) => field.onChange(v != null ? v / 100 : undefined)}
                      fallbackValue={5}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* Position Calculator Subsection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Position Calculator</CardTitle>
          <CardDescription>
            Position size adjusts based on agent balance. Set the balance ranges below, then the min/max position size for each range.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert className="bg-muted/50">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Set three boundary values. The balance ranges update automatically. Then configure min/max position size for each range.
            </AlertDescription>
          </Alert>

          {/* Balance ranges + Position Sizes - integrated by category */}
          <PositionCalculatorForm form={form} />

          {/* Randomization Toggle */}
          <div className="space-y-4 pt-4 border-t">
            <div>
              <h4 className="text-sm font-medium mb-2">Position Randomization</h4>
              <p className="text-sm text-muted-foreground mb-4">
                When enabled, position size is randomly selected between min and max.
                When disabled, always uses the maximum position size.
              </p>
            </div>
            <FormField
              control={form.control}
              name="positionCalculator.randomization.enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      id="position-randomization"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel 
                    htmlFor="position-randomization"
                    className="text-sm font-normal cursor-pointer"
                  >
                    Enable Position Randomization
                  </FormLabel>
                </FormItem>
              )}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

