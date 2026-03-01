'use client';

import * as React from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Button } from '@/shared/components/ui/button';
import { NumericInput } from '@/shared/components/ui/formatted-number-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import { Trash2, Plus, AlertCircle, GripVertical } from 'lucide-react';
import type { AgentTradingConfigFormValues } from './trading-config-form-schema';

/**
 * Trailing Levels Editor Component
 * 
 * Table editor for managing trailing stop loss levels with inline editing.
 */
export function TrailingLevelsEditor() {
  const form = useFormContext<AgentTradingConfigFormValues>();
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'stopLoss.trailingLevels',
  });

  // Watch all trailing levels to update chart in real-time
  const trailingLevels = form.watch('stopLoss.trailingLevels');

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);

  // Helper function to sort levels descending by change
  const sortLevels = React.useCallback(() => {
    const levels = form.getValues('stopLoss.trailingLevels');
    if (!levels || levels.length === 0) return;
    
    const sorted = [...levels].sort((a, b) => (b?.change || 0) - (a?.change || 0));
    form.setValue('stopLoss.trailingLevels', sorted, { shouldDirty: true, shouldValidate: true });
  }, [form]);

  const handleAddLevel = () => {
    // Default values for new level
    const currentLevels = form.getValues('stopLoss.trailingLevels');
    const lastChange = currentLevels.length > 0 
      ? Math.min(...currentLevels.map(l => l.change || 0))
      : 100;
    
    append({
      change: Math.max(20, lastChange - 10), // Default to 10% less than lowest, minimum 20%
      stopLoss: Math.max(10, lastChange - 20), // Default stop loss
    });
    
    // Sort after adding (use setTimeout to ensure append completes first)
    setTimeout(() => {
      sortLevels();
    }, 0);
  };

  const handleDelete = (index: number) => {
    remove(index);
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      move(draggedIndex, dropIndex);
      form.trigger('stopLoss.trailingLevels'); // Trigger validation after move
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Check for validation errors
  const errors = form.formState.errors.stopLoss?.trailingLevels;
  const hasSortError = errors && Array.isArray(errors) && errors.some(e => e);

  return (
    <div className="space-y-4">
      {/* Validation Error */}
      {hasSortError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Trailing levels must be sorted in descending order by price increase percentage.
            Levels are automatically sorted, but please check your values.
          </AlertDescription>
        </Alert>
      )}

      {/* Table Editor */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead className="w-[120px]">Price Increase %</TableHead>
              <TableHead className="w-[120px]">Stop Loss %</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No trailing levels. Click "Add Level" to add one.
                </TableCell>
              </TableRow>
            ) : (
              fields.map((field, index) => (
                <TableRow 
                  key={field.id}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`
                    transition-colors
                    ${draggedIndex === index ? 'opacity-50' : ''}
                    ${dragOverIndex === index ? 'bg-muted border-t-2 border-primary' : ''}
                  `}
                >
                  {/* Drag Handle */}
                  <TableCell className="w-[50px]">
                    <div
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragEnd={handleDragEnd}
                      className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
                    >
                      <GripVertical className="h-5 w-5" />
                    </div>
                  </TableCell>
                  {/* Price Increase % - Inline Editable */}
                  <TableCell>
                    <NumericInput
                      value={form.watch(`stopLoss.trailingLevels.${index}.change`)}
                      onChange={(v) =>
                        form.setValue(
                          `stopLoss.trailingLevels.${index}.change`,
                          v ?? 0,
                          { shouldValidate: true, shouldDirty: true }
                        )
                      }
                      onBlur={() => sortLevels()}
                      className="w-full"
                      onDragStart={(e) => e.stopPropagation()}
                    />
                    {form.formState.errors.stopLoss?.trailingLevels?.[index]?.change && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.stopLoss.trailingLevels[index]?.change?.message}
                      </p>
                    )}
                  </TableCell>

                  {/* Stop Loss % - Inline Editable */}
                  <TableCell>
                    <NumericInput
                      value={form.watch(`stopLoss.trailingLevels.${index}.stopLoss`)}
                      onChange={(v) =>
                        form.setValue(
                          `stopLoss.trailingLevels.${index}.stopLoss`,
                          v ?? 0,
                          { shouldValidate: true, shouldDirty: true }
                        )
                      }
                      className="w-full"
                      onDragStart={(e) => e.stopPropagation()}
                    />
                    {form.formState.errors.stopLoss?.trailingLevels?.[index]?.stopLoss && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.stopLoss.trailingLevels[index]?.stopLoss?.message}
                      </p>
                    )}
                  </TableCell>

                  {/* Actions */}
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(index)}
                      title="Delete level"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Add Level Button */}
        <div className="p-4 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddLevel}
            className="w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Level
          </Button>
        </div>
      </div>

    </div>
  );
}

