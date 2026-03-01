/**
 * Trading Config Export Utility
 *
 * Serialises an AgentTradingConfig to JSON and triggers a browser download.
 */

import type { AgentTradingConfig } from '@nexgent/shared';

/** Characters that are invalid in most OS file names. */
const UNSAFE_FILENAME_CHARS = /[/\\:*?"<>|]/g;

/**
 * Sanitise a string for use as part of a filename.
 * Replaces unsafe characters with hyphens and collapses runs.
 */
function sanitiseForFilename(name: string): string {
  return name
    .replace(UNSAFE_FILENAME_CHARS, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .trim() || 'agent';
}

/**
 * Download a trading configuration as a prettified JSON file.
 *
 * @param config - The saved trading configuration to export
 * @param agentName - Agent name used in the downloaded filename
 */
export function downloadTradingConfigJson(
  config: AgentTradingConfig,
  agentName: string
): void {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitiseForFilename(agentName)}-trading-config.json`;
  document.body.appendChild(anchor);
  anchor.click();

  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
