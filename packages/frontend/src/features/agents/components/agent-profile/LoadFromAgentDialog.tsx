'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Label } from '@/shared/components/ui/label';
import { Loader2, FolderInput } from 'lucide-react';
import { useUser } from '@/shared/contexts/user.context';
import { useAgents } from '@/features/agents';
import { AgentsService } from '@/infrastructure/api/services/agents.service';
import { useToast } from '@/shared/hooks/use-toast';
import type { AgentTradingConfig } from '@nexgent/shared';

const agentsService = new AgentsService();

interface LoadFromAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAgentId: string;
  /** Called with the fetched config when the user confirms. */
  onLoadConfig: (config: AgentTradingConfig) => void;
  /** Whether the parent form has unsaved changes (triggers a confirmation step). */
  hasUnsavedChanges?: boolean;
}

/**
 * Dialog that lets a user pick another agent and load its trading config
 * into the current form for customisation.
 */
export function LoadFromAgentDialog({
  open,
  onOpenChange,
  currentAgentId,
  onLoadConfig,
  hasUnsavedChanges = false,
}: LoadFromAgentDialogProps) {
  const { user } = useUser();
  const { data: agents } = useAgents(user?.id);
  const { toast } = useToast();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);

  const otherAgents = (agents ?? []).filter((a) => a.id !== currentAgentId);

  const handleLoad = async () => {
    if (!selectedAgentId) return;

    if (hasUnsavedChanges && !showOverwriteConfirm) {
      setShowOverwriteConfirm(true);
      return;
    }

    setIsLoading(true);
    try {
      const config = await agentsService.getTradingConfig(selectedAgentId);
      onLoadConfig(config);
      handleClose();

      const agentName = otherAgents.find((a) => a.id === selectedAgentId)?.name ?? 'agent';
      toast({
        title: 'Config loaded',
        description: `Loaded trading config from ${agentName}. Review and save when ready.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to load config',
        description: error instanceof Error ? error.message : 'Could not fetch trading configuration.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setSelectedAgentId('');
    setShowOverwriteConfirm(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-5 w-5" />
            Load Config from Agent
          </DialogTitle>
          <DialogDescription>
            Select another agent to copy its trading configuration into the current form.
            You can customise the settings before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="agent-select">Source Agent</Label>
            {otherAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No other agents available. Create another agent first.
              </p>
            ) : (
              <Select
                value={selectedAgentId}
                onValueChange={(value) => {
                  setSelectedAgentId(value);
                  setShowOverwriteConfirm(false);
                }}
              >
                <SelectTrigger id="agent-select" className="w-full">
                  <SelectValue placeholder="Choose an agent..." />
                </SelectTrigger>
                <SelectContent>
                  {otherAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {showOverwriteConfirm && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              You have unsaved changes. Loading a new config will overwrite them.
              Click <strong>Load Config</strong> again to confirm.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleLoad}
            disabled={!selectedAgentId || isLoading || otherAgents.length === 0}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load Config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
