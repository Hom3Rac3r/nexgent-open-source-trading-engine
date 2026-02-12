'use client';

/**
 * System Health Card Component
 * 
 * Displays overall system health status and individual service health.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { CheckCircle2, XCircle, AlertCircle, Activity, Database, Zap, Globe, Server, Eye, EyeOff } from 'lucide-react';
import { useSystemHealth } from '@/infrastructure/api/hooks/use-system-health';
import { LoadingSpinner } from '@/shared/components';
import type { SystemStatus, ServiceStatus } from '@/infrastructure/api/services/health.service';

/**
 * Format uptime in seconds to human-readable string
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get status badge variant and styling
 */
function getStatusBadge(status: SystemStatus | ServiceStatus) {
  switch (status) {
    case 'healthy':
      return {
        variant: 'default' as const,
        className: 'bg-green-500/10 text-green-600 border-green-500/20',
        icon: CheckCircle2,
      };
    case 'degraded':
      return {
        variant: 'default' as const,
        className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
        icon: AlertCircle,
      };
    case 'unhealthy':
      return {
        variant: 'default' as const,
        className: 'bg-red-500/10 text-red-600 border-red-500/20',
        icon: XCircle,
      };
    default:
      return {
        variant: 'secondary' as const,
        className: 'bg-muted text-muted-foreground',
        icon: XCircle,
      };
  }
}

/**
 * Get latency color class
 */
function getLatencyColor(latency?: number): string {
  if (!latency) return 'text-muted-foreground';
  if (latency < 50) return 'text-green-600';
  if (latency < 100) return 'text-yellow-600';
  return 'text-red-600';
}

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/** Placeholder shown when URL is hidden */
const MASKED_PLACEHOLDER = '••••••••••••••••••••';

export function SystemHealthCard() {
  const { data: health, isLoading, error } = useSystemHealth();
  const [frontendUrl, setFrontendUrl] = useState<string>('');
  const [showFrontendUrl, setShowFrontendUrl] = useState(false);
  const [showBackendUrl, setShowBackendUrl] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') setFrontendUrl(window.location.origin);
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Current system and service health status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8">
            <LoadingSpinner size="md" text="Loading health status..." />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !health) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Current system and service health status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm">Failed to load health status</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const overallStatus = getStatusBadge(health.status);
  const OverallStatusIcon = overallStatus.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>System Health</CardTitle>
            <CardDescription>Current system and service health status</CardDescription>
          </div>
          <Badge variant={overallStatus.variant} className={overallStatus.className}>
            <OverallStatusIcon className="mr-1.5 h-3 w-3" />
            {health.status.charAt(0).toUpperCase() + health.status.slice(1)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Uptime</p>
            <p className="text-sm font-medium">{formatUptime(health.uptime)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Last Checked</p>
            <p className="text-sm font-medium">
              {new Date(health.timestamp).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </p>
          </div>
        </div>

        {/* Service Health */}
        <div className="space-y-3 pt-2 border-t">
          <h4 className="text-sm font-semibold">Service Status</h4>

          {/* Frontend Network - hidden by default, reveal via icon */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Globe className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Frontend Network</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {showFrontendUrl ? (frontendUrl || '—') : MASKED_PLACEHOLDER}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 -my-0.5"
                    onClick={() => setShowFrontendUrl(prev => !prev)}
                    title={showFrontendUrl ? 'Hide URL' : 'Reveal URL'}
                    aria-label={showFrontendUrl ? 'Hide frontend URL' : 'Reveal frontend URL'}
                  >
                    {showFrontendUrl ? (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-green-600 shrink-0 ml-2">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Healthy</span>
            </div>
          </div>

          {/* Backend Network - hidden by default, reveal via icon */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Server className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Backend Network</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {showBackendUrl ? BACKEND_URL : MASKED_PLACEHOLDER}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 -my-0.5"
                    onClick={() => setShowBackendUrl(prev => !prev)}
                    title={showBackendUrl ? 'Hide URL' : 'Reveal URL'}
                    aria-label={showBackendUrl ? 'Hide backend URL' : 'Reveal backend URL'}
                  >
                    {showBackendUrl ? (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-green-600 shrink-0 ml-2">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Healthy</span>
            </div>
          </div>
          
          {/* Database */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Database</p>
                {health.services.database.latency !== undefined && (
                  <p className={`text-xs ${getLatencyColor(health.services.database.latency)}`}>
                    {health.services.database.latency}ms
                  </p>
                )}
              </div>
            </div>
            {health.services.database.status === 'healthy' ? (
              <div className="flex items-center gap-1.5 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-medium">Healthy</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-red-600">
                <XCircle className="h-4 w-4" />
                <span className="text-xs font-medium">Unhealthy</span>
              </div>
            )}
          </div>

          {/* Redis */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              <Zap className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Redis Cache</p>
                {health.services.redis.latency !== undefined && (
                  <p className={`text-xs ${getLatencyColor(health.services.redis.latency)}`}>
                    {health.services.redis.latency}ms
                  </p>
                )}
              </div>
            </div>
            {health.services.redis.status === 'healthy' ? (
              <div className="flex items-center gap-1.5 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-medium">Healthy</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-red-600">
                <XCircle className="h-4 w-4" />
                <span className="text-xs font-medium">Unhealthy</span>
              </div>
            )}
          </div>

          {/* Queue */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Queue Worker</p>
                {health.services.queue.latency !== undefined && (
                  <p className={`text-xs ${getLatencyColor(health.services.queue.latency)}`}>
                    {health.services.queue.latency}ms
                  </p>
                )}
                {health.services.queue.workerCount !== undefined && health.services.queue.latency === undefined && (
                  <p className="text-xs text-muted-foreground">
                    {health.services.queue.workerCount} worker{health.services.queue.workerCount !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
            {health.services.queue.status === 'healthy' ? (
              <div className="flex items-center gap-1.5 text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-medium">Healthy</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-red-600">
                <XCircle className="h-4 w-4" />
                <span className="text-xs font-medium">Unhealthy</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

