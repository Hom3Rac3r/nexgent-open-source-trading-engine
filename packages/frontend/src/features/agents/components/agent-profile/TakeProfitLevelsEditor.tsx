'use client';

import { useFieldArray, useFormContext } from 'react-hook-form';
import { Button } from '@/shared/components/ui/button';
import { NumericInput } from '@/shared/components/ui/formatted-number-input';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/shared/components/ui/form';
import { Label } from '@/shared/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';

/**
 * Take-Profit Levels Editor Component
 * 
 * Allows users to define take-profit levels with target gain percentages
 * and the percentage of the original position to sell at each level.
 */
export function TakeProfitLevelsEditor() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'takeProfit.levels',
  });

  // Calculate total sell percentage for validation display
  const levels = form.watch('takeProfit.levels') || [];
  const moonBagEnabled = form.watch('takeProfit.moonBag.enabled');
  const moonBagPercent = form.watch('takeProfit.moonBag.retainPercent') || 0;
  const totalSellPercent = levels.reduce((sum, level) => sum + (level.sellPercent || 0), 0);
  const totalAllocation = totalSellPercent + (moonBagEnabled ? moonBagPercent : 0);

  const handleAddLevel = () => {
    const lastLevel = levels[levels.length - 1];
    
    // Default: 100% higher target than last, or 50% if first
    const newTargetPercent = lastLevel 
      ? lastLevel.targetPercent + 100 
      : 50;
    
    // Default: 25% sell amount (typical for 4 levels)
    const newSellPercent = 25;
    
    append({ 
      targetPercent: newTargetPercent,
      sellPercent: newSellPercent,
    });
  };

  const handleRemoveLevel = (index: number) => {
    remove(index);
  };

  const exceedsLimit = totalAllocation > 100;

  return (
    <div className="space-y-4">
      {/* Allocation exceeded alert */}
      {exceedsLimit && (
        <Alert className="border-red-500 bg-red-500/10 text-red-500">
          <AlertDescription>
            ⚠️ <strong>Total allocation exceeds 100%!</strong> Your take-profit levels ({totalSellPercent}%) 
            {moonBagEnabled && ` + moon bag (${moonBagPercent}%)`} = {totalAllocation}%. 
            Please reduce the sell percentages or disable moon bag.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Take-Profit Levels</Label>
          <p className="text-xs mt-1 text-muted-foreground">
            Total allocation: {totalAllocation}%
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddLevel}
          disabled={fields.length >= 10}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Level
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
          <p>No take-profit levels defined.</p>
          <p className="text-sm mt-1">Click &quot;Add Level&quot; to create your first target.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Target Gain %</TableHead>
                <TableHead>Sell %</TableHead>
                <TableHead className="w-[80px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field, index) => (
                <TableRow key={field.id}>
                  <TableCell className="font-mono text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <FormField
                      control={form.control}
                      name={`takeProfit.levels.${index}.targetPercent`}
                      render={({ field }) => (
                        <FormItem className="space-y-0">
                          <FormControl>
                            <div className="flex items-center gap-1">
                              <NumericInput
                                value={field.value}
                                onChange={(v) => field.onChange(v)}
                                className="max-w-[100px]"
                              />
                              <span className="text-muted-foreground text-sm">%</span>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <FormField
                      control={form.control}
                      name={`takeProfit.levels.${index}.sellPercent`}
                      render={({ field }) => (
                        <FormItem className="space-y-0">
                          <FormControl>
                            <div className="flex items-center gap-1">
                              <NumericInput
                                value={field.value}
                                onChange={(v) => field.onChange(v)}
                                className="max-w-[100px]"
                              />
                              <span className="text-muted-foreground text-sm">%</span>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveLevel(index)}
                      className="text-destructive hover:text-destructive"
                      disabled={fields.length <= 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Level explanation */}
      <div className="text-sm text-muted-foreground space-y-1">
        <p><strong>Target Gain %:</strong> When price rises this much from entry, trigger sale</p>
        <p><strong>Sell %:</strong> Percentage of your <em>original</em> position to sell at this level</p>
        <p className="text-xs">Example: Target 50%, Sell 25% = When up 50%, sell 25% of original position</p>
      </div>
    </div>
  );
}
