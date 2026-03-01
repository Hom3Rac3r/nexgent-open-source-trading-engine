'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert';
import { Button } from '@/shared/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { useAgentSelection } from '@/shared/contexts/agent-selection.context';
import { useAgent } from '@/features/agents';
import { useAgentTradingConfig } from '@/features/agents';
import { ProfileSection } from '@/features/agents/components/agent-profile/ProfileSection';
import { StrategySection } from '@/features/agents/components/agent-profile/StrategySection';
import { PageSkeleton, ErrorState } from '@/shared/components';

/**
 * Agent Profile & Strategy Page
 * 
 * Allows users to configure their agent's profile information and trading strategy.
 */
export default function AgentProfilePage() {
  const router = useRouter();
  const { selectedAgentId, hasSelectedAgent } = useAgentSelection();
  
  // Fetch agent data
  const { data: agent, isLoading: isLoadingAgent, error: agentError } = useAgent(selectedAgentId || undefined);
  
  // Fetch trading configuration
  const { data: tradingConfig, isLoading: isLoadingConfig, error: configError } = useAgentTradingConfig(
    selectedAgentId || undefined
  );

  // Handle case where no agent is selected
  if (!hasSelectedAgent && !isLoadingAgent) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Agent Selected</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>Please select an agent to view and edit its profile and strategy.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/dashboard/general')}
            >
              Go to Agents
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Loading state
  const isLoading = isLoadingAgent || isLoadingConfig;
  
  if (isLoading) {
    return <PageSkeleton showHeader showCards cardCount={2} />;
  }

  // Error state
  if (agentError || configError) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6">
        <ErrorState
          error={agentError || configError}
          title="Error Loading Agent"
          onRetry={() => {
            window.location.reload();
          }}
        />
      </div>
    );
  }

  // No agent data
  if (!agent) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Agent Not Found</AlertTitle>
          <AlertDescription>
            The selected agent could not be found. Please select a different agent.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Agent Profile & Strategy</h1>
        <p className="text-muted-foreground">
          Configure your agent's profile information and trading strategy settings.
        </p>
      </div>

      {/* Profile Section - Always visible */}
      <ProfileSection agent={agent} />

      {/* Strategy Section - Below profile */}
      {tradingConfig && <StrategySection agentId={agent.id} agentName={agent.name} initialConfig={tradingConfig} />}
      
      {!tradingConfig && !isLoadingConfig && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Not Available</AlertTitle>
          <AlertDescription>
            Trading configuration could not be loaded. Please refresh the page or try again later.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

