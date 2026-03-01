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
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';

/**
 * DCA Levels Editor Component
 * 
 * Allows users to manually define DCA levels when using custom mode.
 * Each level has a drop percentage (when to trigger) and buy percentage (how much to buy).
 */
export function DCALevelsEditor() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'dca.levels',
  });

  const handleAddLevel = () => {
    // Get the last level to suggest a new one
    const levels = form.getValues('dca.levels') || [];
    const lastLevel = levels[levels.length - 1];
    
    // Default: 10% lower drop than last, or -15% if first
    const newDropPercent = lastLevel 
      ? lastLevel.dropPercent - 15 
      : -15;
    
    // Default: 50% buy amount
    const newBuyPercent = lastLevel 
      ? Math.min(lastLevel.buyPercent + 25, 100)
      : 50;
    
    append({ 
      dropPercent: Math.max(newDropPercent, -95), // Don't go below -95%
      buyPercent: newBuyPercent,
    });
  };

  const handleRemoveLevel = (index: number) => {
    remove(index);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">DCA Levels</Label>
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
          <p>No DCA levels defined.</p>
          <p className="text-sm mt-1">Click "Add Level" to create your first DCA trigger.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Drop % (trigger)</TableHead>
                <TableHead>Buy % (amount)</TableHead>
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
                      name={`dca.levels.${index}.dropPercent`}
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
                      name={`dca.levels.${index}.buyPercent`}
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
      <div className="text-sm text-muted-foreground space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
        <p><strong>Drop %:</strong> When price drops this much from your average, trigger DCA (must be negative, e.g. -20)</p>
        <p><strong>Buy %:</strong> How much to buy as a percentage of your current position value</p>
        <p><strong>Order:</strong> Levels must go from least to most negative (e.g. -15 before -30). Equal values like -20, -20, -20 are allowed — each triggers when price drops 20% from the average at that point.</p>
        <p className="text-xs">Example: Drop -20%, Buy 50% = When price drops 20%, buy 50% more of your position</p>
      </div>
    </div>
  );
}
