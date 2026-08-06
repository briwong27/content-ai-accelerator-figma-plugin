/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />

/**
 * SHARED ARCHITECTURE AND RESULT MODEL
 *
 * This module provides common types and helpers used across all plugin features.
 * It enables consistent result formatting, error reporting, and layer manipulation
 * without breaking existing UI message formats.
 *
 * Key principles:
 * - Preserve existing message fields (count, chars, words, etc.)
 * - Add optional richer fields for future UI improvements
 * - Support reporting skipped layers and their reasons
 * - Provide utilities for layer traversal and editability checks
 */

// ============================================================================
// SHARED TYPES
// ============================================================================

/**
 * Represents why a layer was skipped during an operation.
 */
export type SkipReason =
  | 'locked'
  | 'component-instance'
  | 'not-text-node'
  | 'empty-text'
  | 'font-unavailable'
  | 'write-failed'
  | 'not-editable';

/**
 * Metadata about a single layer for reporting and display.
 */
export interface LayerMetadata {
  id: string;
  name: string;
  type: 'text' | 'frame' | 'group' | 'component' | 'instance' | 'other';
  text?: string;
  frameName?: string;
  isLocked?: boolean;
  isComponent?: boolean;
  isInstance?: boolean;
}

/**
 * Represents a layer that was skipped during an operation.
 */
export interface SkippedLayer {
  layer: LayerMetadata;
  reason: SkipReason;
  details?: string;
}

/**
 * Generic result structure for all features.
 * Each feature can extend this with feature-specific fields.
 */
export interface FeatureResult {
  // Core messaging (preserved for compatibility)
  count?: number; // Generic count
  chars?: number; // Character count
  words?: number; // Word count

  // Success state
  success: boolean;
  message?: string;

  // Applied changes
  applied?: number; // How many layers/items were changed
  unchanged?: number; // How many were not changed

  // Skipped items
  skipped: SkippedLayer[];

  // Richer metadata (for future UI improvements)
  layers?: LayerMetadata[];

  // Feature-specific optional fields
  [key: string]: unknown;
}

/**
 * Result of a text mutation operation.
 */
export interface MutationResult extends FeatureResult {
  applied: number; // Required for mutation results
  changedNodes?: number; // Alternate name for applied (backward compat)
}

/**
 * Result of a scan operation (no mutation).
 */
export interface ScanResult extends FeatureResult {
  violations?: Array<{
    layer: LayerMetadata;
    issue: string;
    suggestion?: string;
  }>;
}

/**
 * Result of a count operation.
 */
export interface CountResult extends FeatureResult {
  chars: number;
  words: number;
  layerCounts?: Array<{
    layer: LayerMetadata;
    chars: number;
    words: number;
  }>;
}

/**
 * Result of a find operation.
 */
export interface FindResult extends FeatureResult {
  matches: Array<{
    layer: LayerMetadata;
    matchCount: number;
    preview?: string;
  }>;
}

/**
 * Represents pending changes awaiting user confirmation.
 */
export interface PendingChange {
  layerId: string;
  before: string;
  after: string;
  layer: LayerMetadata;
  isEditable: boolean;
}

/**
 * Represents a set of pending changes for preview/confirmation.
 */
export interface PendingChanges {
  changes: PendingChange[];
  totalCount: number;
  editableCount: number;
  skipped: SkippedLayer[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the display name of a layer.
 * Returns the layer's name, or "Unknown" if not available.
 */
export function getLayerName(node: BaseNode): string {
  if ('name' in node) {
    return node.name || 'Unnamed';
  }
  return 'Unknown';
}

/**
 * Find the parent frame of a node and return its name.
 * Returns undefined if no parent frame is found.
 */
export function getFrameName(node: BaseNode): string | undefined {
  let current: BaseNode | null = node;

  while (current) {
    if (current.type === 'FRAME') {
      return getLayerName(current);
    }
    current = 'parent' in current ? current.parent : null;
  }

  return undefined;
}

/**
 * Determine if a node can be edited by the plugin.
 * Returns false if locked, a component instance, or not editable.
 */
export function isEditableNode(node: BaseNode): boolean {
  // Check if locked
  if ('locked' in node && node.locked) {
    return false;
  }

  // Check if component instance (can't edit text in instances)
  if (node.type === 'INSTANCE') {
    return false;
  }

  // Text nodes are editable if they're not locked
  if (node.type === 'TEXT') {
    return true;
  }

  return false;
}

/**
 * Create metadata for a text node.
 */
export function createLayerMetadata(node: TextNode): LayerMetadata {
  return {
    id: node.id,
    name: getLayerName(node),
    type: 'text',
    text: node.characters,
    frameName: getFrameName(node),
    isLocked: node.locked || false,
    isComponent: node.parent?.type === 'COMPONENT',
    isInstance: node.parent?.type === 'INSTANCE',
  };
}

/**
 * Check if a text node should be skipped and return the reason.
 * Returns null if the node should not be skipped.
 */
export function getSkipReason(node: BaseNode): SkipReason | null {
  if (node.type !== 'TEXT') {
    return 'not-text-node';
  }

  const textNode = node as TextNode;

  if (textNode.locked) {
    return 'locked';
  }

  if (textNode.parent?.type === 'INSTANCE') {
    return 'component-instance';
  }

  if (textNode.characters.length === 0) {
    return 'empty-text';
  }

  return null;
}

/**
 * Create a SkippedLayer record.
 */
export function createSkippedLayer(node: TextNode, reason: SkipReason, details?: string): SkippedLayer {
  return {
    layer: createLayerMetadata(node),
    reason,
    details,
  };
}

/**
 * Safely apply text to a node with styled runs.
 * Returns true on success, false on failure.
 * Stores details about any failure in the result object.
 */
export async function safeApplyText(
  node: TextNode,
  runs: Array<{ text: string; fontName: FontName; fontSize: number }>,
  result?: { errors: string[] }
): Promise<boolean> {
  try {
    // Load all unique fonts first
    const seen = new Set<string>();
    for (const run of runs) {
      const key = `${run.fontName.family}::${run.fontName.style}`;
      if (!seen.has(key)) {
        seen.add(key);
        await figma.loadFontAsync(run.fontName);
      }
    }

    // Allow height to grow so translated text wraps
    if (node.textAutoResize === 'NONE') {
      node.textAutoResize = 'HEIGHT';
    }

    // Set full text (resets all styling to uniform)
    node.characters = runs.map(r => r.text).join('');

    // Re-apply per-run styles
    let pos = 0;
    for (const run of runs) {
      const end = pos + run.text.length;
      if (end > pos) {
        node.setRangeFontName(pos, end, run.fontName);
        node.setRangeFontSize(pos, end, run.fontSize);
      }
      pos = end;
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (result) {
      result.errors.push(`Failed to apply text to layer "${getLayerName(node)}": ${message}`);
    }
    return false;
  }
}

/**
 * Collect skipped layers and format them for reporting.
 */
export function summarizeSkipped(skipped: SkippedLayer[]): string {
  if (skipped.length === 0) return '';

  const byReason: Record<SkipReason, number> = {
    'locked': 0,
    'component-instance': 0,
    'not-text-node': 0,
    'empty-text': 0,
    'font-unavailable': 0,
    'write-failed': 0,
    'not-editable': 0,
  };

  for (const skip of skipped) {
    byReason[skip.reason]++;
  }

  const parts: string[] = [];
  if (byReason.locked > 0) parts.push(`${byReason.locked} locked`);
  if (byReason['component-instance'] > 0) parts.push(`${byReason['component-instance']} component instances`);
  if (byReason['write-failed'] > 0) parts.push(`${byReason['write-failed']} with write errors`);
  if (byReason['font-unavailable'] > 0) parts.push(`${byReason['font-unavailable']} with missing fonts`);

  return parts.length > 0 ? `Skipped: ${parts.join(', ')}` : '';
}

/**
 * Create a success message that includes applied and skipped counts.
 */
export function formatSuccessMessage(applied: number, total: number, skipped: SkippedLayer[]): string {
  let msg = `Applied to ${applied} of ${total} text layer${total === 1 ? '' : 's'}`;

  const skippedSummary = summarizeSkipped(skipped);
  if (skippedSummary) {
    msg += `. ${skippedSummary}`;
  }

  return msg;
}

/**
 * Create an error message for when no text is found.
 */
export function formatEmptyScopeMessage(scope: 'selection' | 'page' | 'all'): string {
  if (scope === 'page') {
    return 'Please select a frame first';
  }
  return 'No text layers found in scope';
}
