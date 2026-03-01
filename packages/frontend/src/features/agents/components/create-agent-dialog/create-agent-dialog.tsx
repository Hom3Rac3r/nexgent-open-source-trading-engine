'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { useToast } from '@/shared/hooks/use-toast';
import { useCreateAgent, useUpdateAgentTradingConfig } from '@/features/agents';
import { useAgentSelection } from '@/shared/contexts/agent-selection.context';
import { Transition } from '@/shared/components/ui/transition';
import { StrategyExplanation } from '@/features/agents/components/agent-profile/StrategyExplanation';
import { Separator } from '@/shared/components/ui/separator';
import { Alert, AlertDescription } from '@/shared/components/ui/alert';
import type { StopLossMode } from '@nexgent/shared';
import { GripVertical, TrendingUp, Layers, Settings, Info, FolderInput } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useUser } from '@/shared/contexts/user.context';
import { useAgents } from '@/features/agents';
import { AgentsService } from '@/infrastructure/api/services/agents.service';

const createAgentSchema = z.object({
  name: z
    .string()
    .min(1, 'Agent name is required')
    .max(255, 'Agent name must be less than 255 characters'),
  stopLossMode: z.enum(['fixed', 'exponential', 'zones', 'custom']),
  /** When set, the new agent copies the full trading config from this agent. */
  sourceAgentId: z.string().optional(),
});

type CreateAgentFormValues = z.infer<typeof createAgentSchema>;

const agentsService = new AgentsService();

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function CreateAgentDialog({
  open,
  onOpenChange,
}: CreateAgentDialogProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useUser();
  const { data: agents } = useAgents(user?.id);
  const createAgentMutation = useCreateAgent();
  const updateConfigMutation = useUpdateAgentTradingConfig();
  const { selectAgent } = useAgentSelection();
  const [showTransition, setShowTransition] = React.useState(false);

  const form = useForm<CreateAgentFormValues>({
    resolver: zodResolver(createAgentSchema),
    defaultValues: {
      name: '',
      stopLossMode: 'fixed',
      sourceAgentId: undefined,
    },
  });

  const stopLossMode = form.watch('stopLossMode') as StopLossMode;
  const sourceAgentId = form.watch('sourceAgentId');

  const onSubmit = async (data: CreateAgentFormValues) => {
    try {
      const newAgent = await createAgentMutation.mutateAsync({
        name: data.name,
      });

      // Apply trading config: either copy from source agent or just set stop loss mode
      try {
        if (data.sourceAgentId) {
          const sourceConfig = await agentsService.getTradingConfig(data.sourceAgentId);
          await updateConfigMutation.mutateAsync({
            agentId: newAgent.id,
            data: sourceConfig,
          });
        } else {
          interface StopLossConfigInput {
            enabled: boolean;
            defaultPercentage: number;
            mode: StopLossMode;
            trailingLevels: Array<{ change: number; stopLoss: number }>;
          }

          const stopLossConfig: StopLossConfigInput = {
            enabled: true,
            defaultPercentage: -32,
            mode: data.stopLossMode,
            trailingLevels: [],
          };

          if (data.stopLossMode === 'custom') {
            stopLossConfig.trailingLevels = [
              { change: 200, stopLoss: 90 },
              { change: 150, stopLoss: 80 },
              { change: 100, stopLoss: 60 },
              { change: 50, stopLoss: 20 },
              { change: 20, stopLoss: 10 },
            ];
          }

          await updateConfigMutation.mutateAsync({
            agentId: newAgent.id,
            data: { stopLoss: stopLossConfig },
          });
        }
      } catch (configError) {
        console.error('Failed to save trading config:', configError);
        toast({
          variant: 'destructive',
          title: 'Warning',
          description: 'Agent created but failed to apply trading settings. You can configure them later.',
        });
      }

      selectAgent(newAgent.id);

      form.reset({
        name: '',
        stopLossMode: 'fixed',
        sourceAgentId: undefined,
      });

      onOpenChange(false);
      setShowTransition(true);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to create agent. Please try again.',
      });
    }
  };

  const handleCancel = () => {
    form.reset({
      name: '',
      stopLossMode: 'fixed',
      sourceAgentId: undefined,
    });
    onOpenChange(false);
  };

  const handleTransitionComplete = () => {
    setShowTransition(false);
    router.push('/dashboard/performance-overview');
  };

  const isLoading = createAgentMutation.isPending || updateConfigMutation.isPending;

  return (
    <>
      <Transition
        show={showTransition}
        onComplete={handleTransitionComplete}
        message="create"
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden p-0 gap-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>Create New Agent</DialogTitle>
          <DialogDescription>
            Create your own AI agent with a unique name.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Enter agent name"
                      disabled={isLoading}
                      aria-describedby="name-error"
                    />
                  </FormControl>
                  <FormMessage id="name-error" />
                </FormItem>
              )}
            />

            <Separator />

            {/* Load from existing agent */}
            {agents && agents.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FolderInput className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Copy Settings from Agent</h3>
                  <span className="text-xs text-muted-foreground">(optional)</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Start with the full trading configuration from an existing agent.
                </p>
                <FormField
                  control={form.control}
                  name="sourceAgentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Select
                          value={field.value ?? 'none'}
                          onValueChange={(value) => field.onChange(value === 'none' ? undefined : value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Start from scratch" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Start from scratch</SelectItem>
                            {agents.map((agent) => (
                              <SelectItem key={agent.id} value={agent.id}>
                                {agent.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {/* Stop Loss Section — hidden when copying from another agent */}
            {!sourceAgentId && (
            <>
            <Separator />

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Stop Loss Strategy</h3>
                <p className="text-sm text-muted-foreground">
                  Choose a stop loss strategy to protect your positions
                </p>
              </div>

              {/* Stop Loss Mode Selector */}
              <FormField
                control={form.control}
                name="stopLossMode"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="grid grid-cols-1 gap-3">
                        {[
                          {
                            value: 'fixed' as StopLossMode,
                            label: 'Fixed Stepper',
                            description: 'Linear 10% steps',
                            icon: GripVertical,
                          },
                          {
                            value: 'exponential' as StopLossMode,
                            label: 'Exponential Decay',
                            description: 'Smooth exponential curve',
                            icon: TrendingUp,
                          },
                          {
                            value: 'zones' as StopLossMode,
                            label: 'Step-Based Zones',
                            description: '5-zone system',
                            icon: Layers,
                          },
                          {
                            value: 'custom' as StopLossMode,
                            label: 'Custom',
                            description: 'Manual levels',
                            icon: Settings,
                          },
                        ].map((mode) => {
                          const isSelected = field.value === mode.value;
                          const Icon = mode.icon;
                          
                          return (
                            <button
                              key={mode.value}
                              type="button"
                              onClick={() => field.onChange(mode.value)}
                              disabled={isLoading}
                              className={cn(
                                "relative flex flex-row items-center gap-3 p-3 rounded-lg border bg-card text-left transition-all",
                                "hover:border-primary/50 hover:shadow-sm",
                                isSelected 
                                  ? "border-primary bg-primary/5 shadow-sm" 
                                  : "border-border"
                              )}
                            >
                              {/* Icon with gradient background */}
                              <div className={cn(
                                "h-10 w-10 shrink-0 rounded-lg flex items-center justify-center border transition-colors",
                                isSelected
                                  ? "bg-gradient-to-br from-primary/20 to-primary/5 border-primary/20"
                                  : "bg-gradient-to-br from-muted/50 to-muted/30 border-border"
                              )}>
                                <Icon className={cn(
                                  "h-5 w-5 transition-colors",
                                  isSelected ? "text-primary" : "text-muted-foreground"
                                )} />
                              </div>
                              
                              {/* Content */}
                              <div className="flex-1 space-y-0.5 min-w-0">
                                <h3 className={cn(
                                  "font-semibold text-sm",
                                  isSelected ? "text-foreground" : "text-foreground"
                                )}>
                                  {mode.label}
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                  {mode.description}
                                </p>
                              </div>

                              {/* Selected indicator */}
                              {isSelected && (
                                <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Strategy Explanation */}
              <StrategyExplanation mode={stopLossMode} />
            </div>

            <Alert className="bg-muted/50">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Don't worry - you can always change these stop loss settings later in your agent's profile.
              </AlertDescription>
            </Alert>
            </>
            )}

            {sourceAgentId && (
              <Alert className="bg-muted/50">
                <FolderInput className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  The full trading configuration (stop loss, position sizing, DCA, take-profit, etc.) will be copied from <strong>{agents?.find(a => a.id === sourceAgentId)?.name}</strong>. You can customise everything after creation.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                id="create-agent-submit"
                type="submit"
                disabled={isLoading}
                className="bg-[#16B364] hover:bg-[#16B364]/90 text-white"
              >
                {isLoading ? 'Creating...' : 'Create Agent'}
              </Button>
            </div>
          </form>
        </Form>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

