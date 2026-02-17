'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';
import { Badge } from '@/shared/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Bot, Trash, Copy, Check } from 'lucide-react';
import { useAgentSelection } from '@/shared/contexts/agent-selection.context';
import { useAgents, useDeleteAgent } from '@/features/agents';
import { CreateAgentDialog } from '@/features/agents';
import { SystemHealthCard } from '@/features/system-health';
import { Transition } from '@/shared/components/ui/transition';
import { useToast } from '@/shared/hooks/use-toast';
import { useUser } from '@/shared/contexts/user.context';
import { LoadingSpinner } from '@/shared/components';
import type { Agent } from '@/shared/types/api.types';

/**
 * Truncate agent ID for display if needed
 * Shows full ID if it's short enough, otherwise truncates
 */
function truncateAgentId(id: string, maxLength: number = 40): string {
  if (id.length <= maxLength) return id;
  return `${id.slice(0, maxLength - 7)}...${id.slice(-4)}`;
}

export default function GeneralPage() {
  const router = useRouter();
  const { user } = useUser();
  const { selectedAgentId, selectAgent } = useAgentSelection();
  const { data: agents = [], isLoading: isLoadingAgents } = useAgents(user?.id);
  const deleteAgentMutation = useDeleteAgent();
  const { toast } = useToast();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null);
  const [copiedAgentId, setCopiedAgentId] = useState<string | null>(null);

  const handleAgentSelect = async (agent: Agent) => {
    if (agent.id === selectedAgentId) return;

    setShowTransition(true);

    // Small delay to ensure transition is visible
    await new Promise(resolve => setTimeout(resolve, 50));

    // Select agent via context
    selectAgent(agent.id);

    // Wait for transition
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Navigate
    router.push('/dashboard/performance-overview');
  };

  const handleTransitionComplete = () => {
    setShowTransition(false);
  };

  const handleDeleteAgent = async () => {
    if (!deleteAgentId || deleteAgentMutation.isPending) return;

    try {
      await deleteAgentMutation.mutateAsync(deleteAgentId);

      // If deleted agent was selected, the context will handle clearing
      toast({
        title: 'Agent Deleted',
        description: 'The agent has been successfully deleted.',
      });

      setDeleteAgentId(null);
    } catch (error) {
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete agent.',
        variant: 'destructive',
      });
    }
  };

  const handleCopyAgentId = async (agentId: string) => {
    try {
      await navigator.clipboard.writeText(agentId);
      setCopiedAgentId(agentId);
      setTimeout(() => setCopiedAgentId(null), 2000);
      toast({
        title: 'Copied',
        description: 'Agent ID copied to clipboard',
      });
    } catch (error) {
      toast({
        title: 'Copy Failed',
        description: 'Failed to copy agent ID to clipboard.',
        variant: 'destructive',
      });
    }
  };

  const isLoading = isLoadingAgents;

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <Transition show={showTransition} onComplete={handleTransitionComplete} message="switch" />
      
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-2xl font-bold">General</CardTitle>
                <CardDescription className="text-muted-foreground max-w-[800px]">
                  Monitor system health and manage your agents.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* System Health Section */}
            <SystemHealthCard />

            {/* Agent List Section */}
            <Card>
              <CardHeader>
                <CardTitle>Your Agents</CardTitle>
                <CardDescription>
                  You have created <b>{agents.length}</b> agent{agents.length === 1 ? '' : 's'}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingAgents ? (
                  <div className="flex items-center justify-center p-8">
                    <LoadingSpinner size="md" text="Loading agents..." />
                  </div>
                ) : agents.length > 0 ? (
                  <div className="space-y-4">
                    {agents.map(agent => (
                      <div key={agent.id} className="flex items-center space-x-4 p-4 rounded-lg border bg-card">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-secondary">
                            <Bot className="h-5 w-5" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-1 min-w-0 overflow-hidden">
                          <p className="text-sm font-medium leading-none truncate" title={agent.name || undefined}>
                            {agent.name || 'Unnamed Agent'}
                          </p>
                          <div className="flex items-center gap-2">
                            <p className="text-sm text-muted-foreground font-mono">
                              ID: {truncateAgentId(agent.id)}
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleCopyAgentId(agent.id)}
                              title="Copy Agent ID"
                            >
                              {copiedAgentId === agent.id ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center justify-center space-x-2 h-full">
                          {agent.id === selectedAgentId ? (
                            <span className="text-sm text-muted-foreground">Currently viewing</span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAgentSelect(agent)}
                            >
                              Switch to agent
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteAgentId(agent.id)}
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-4 text-center space-y-2 min-h-[100px]">
                    <p className="text-sm text-muted-foreground">
                      Create your first agent to get started.
                    </p>
                    <Button onClick={() => setCreateDialogOpen(true)}>
                      Create Agent
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </div>

      {/* Delete Agent Confirmation Dialog */}
      <Dialog open={!!deleteAgentId} onOpenChange={() => !deleteAgentMutation.isPending && setDeleteAgentId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the agent{' '}
              <span className="font-medium">
                {agents.find(a => a.id === deleteAgentId)?.name || 'this agent'}
              </span>
              ? This action cannot be undone and will permanently remove all associated data including
              transactions, balances, and risk profiles.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteAgentId(null)}
              disabled={deleteAgentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAgent}
              disabled={deleteAgentMutation.isPending}
            >
              {deleteAgentMutation.isPending ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Deleting...
                </>
              ) : (
                'Delete Agent'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateAgentDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}


