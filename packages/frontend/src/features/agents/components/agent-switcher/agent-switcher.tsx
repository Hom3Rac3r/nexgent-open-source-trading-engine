"use client"

import * as React from "react"
import { memo, useCallback } from "react"
import { useRouter, usePathname } from 'next/navigation'
import { Check, ChevronsUpDown, Bot } from "lucide-react"
import { useUnsavedChanges } from '@/features/agents/contexts/unsaved-changes.context'
import { cn } from "@/shared/utils/cn"
import { Button } from "@/shared/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover"
import { Transition } from '@/shared/components/ui/transition'
import { useAgentSelection } from '@/shared/contexts/agent-selection.context'
import type { Agent } from '@/shared/types/api.types'

interface AgentSwitcherProps {
  className?: string;
}

function AgentSwitcherComponent({ className }: AgentSwitcherProps) {
  const [open, setOpen] = React.useState(false)
  const [showTransition, setShowTransition] = React.useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const unsavedContext = useUnsavedChanges()

  // Get agent selection state from context
  const { selectedAgentId, selectedAgent, agents, isLoading, selectAgent } = useAgentSelection()

  const isAgentProfile = pathname?.startsWith('/dashboard/agent-profile')

  // Always render Bot icon (no profile images)
  const renderLogo = () => {
    return (
      <div className="h-8 w-8 flex items-center justify-center rounded-full bg-secondary">
        <Bot className="h-5 w-5" />
      </div>
    )
  }

  const performAgentSwitch = useCallback(async (agent: Agent) => {
    setOpen(false)
    setShowTransition(true)
    await new Promise(resolve => setTimeout(resolve, 50))
    selectAgent(agent.id)
    await new Promise(resolve => setTimeout(resolve, 1000))
    router.push('/dashboard/performance-overview')
  }, [selectAgent, router])

  const handleAgentSelect = useCallback(async (agent: Agent) => {
    if (agent.id === selectedAgentId) return

    if (isAgentProfile && unsavedContext?.hasUnsavedChanges) {
      await unsavedContext.promptBeforeNavigate(() => performAgentSwitch(agent))
    } else {
      await performAgentSwitch(agent)
    }
  }, [selectedAgentId, isAgentProfile, unsavedContext, performAgentSwitch]);

  const handleTransitionComplete = useCallback(() => {
    setShowTransition(false)
  }, [])

  return (
    <>
      <Transition show={showTransition} onComplete={handleTransitionComplete} message="switch" />
      <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Select an agent"
          className={cn("w-full justify-between px-4 py-6", className)}
          disabled={agents.length === 0 && !isLoading}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {renderLogo()}
            <div className="flex flex-col items-start min-w-0 flex-1 overflow-hidden">
              <span className="text-sm font-medium truncate w-full" title={selectedAgent?.name}>
                {selectedAgent?.name || 'No agents found'}
              </span>
              <span className="text-xs text-muted-foreground truncate w-full">
                {agents.length === 0 && !isLoading ? "Create an agent to start" : "Click to swap agent"}
              </span>
            </div>
          </div>
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" side="right" align="start" style={{ zIndex: 9999 }}>
        <div className="space-y-2 p-2">
          {agents.length === 0 ? (
            <div className="px-2 py-4 text-sm text-muted-foreground text-center">
              No agents found
            </div>
          ) : (
            agents.map((agent) => (
              <Button
                key={agent.id}
                variant="ghost"
                className="w-full justify-start gap-2 min-w-0"
                onClick={() => handleAgentSelect(agent)}
              >
                {renderLogo()}
                <div className="flex flex-col items-start flex-1 min-w-0 overflow-hidden">
                  <div className="flex items-center justify-between w-full gap-2 min-w-0">
                    <span className="text-sm truncate" title={agent.name}>
                      {agent.name}
                    </span>
                  </div>
                </div>
                {selectedAgentId === agent.id && (
                  <Check className="ml-auto h-4 w-4 shrink-0" />
                )}
              </Button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
    </>
  )
}

// Memoize component to prevent unnecessary re-renders
export const AgentSwitcher = memo(AgentSwitcherComponent);

