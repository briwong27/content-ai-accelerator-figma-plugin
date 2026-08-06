"use strict";
/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLayerName = getLayerName;
exports.getFrameName = getFrameName;
exports.isEditableNode = isEditableNode;
exports.createLayerMetadata = createLayerMetadata;
exports.getSkipReason = getSkipReason;
exports.createSkippedLayer = createSkippedLayer;
exports.safeApplyText = safeApplyText;
exports.summarizeSkipped = summarizeSkipped;
exports.formatSuccessMessage = formatSuccessMessage;
exports.formatEmptyScopeMessage = formatEmptyScopeMessage;
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
/**
 * Get the display name of a layer.
 * Returns the layer's name, or "Unknown" if not available.
 */
function getLayerName(node) {
    if ('name' in node) {
        return node.name || 'Unnamed';
    }
    return 'Unknown';
}
/**
 * Find the parent frame of a node and return its name.
 * Returns undefined if no parent frame is found.
 */
function getFrameName(node) {
    let current = node;
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
function isEditableNode(node) {
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
function createLayerMetadata(node) {
    var _a, _b;
    return {
        id: node.id,
        name: getLayerName(node),
        type: 'text',
        text: node.characters,
        frameName: getFrameName(node),
        isLocked: node.locked || false,
        isComponent: ((_a = node.parent) === null || _a === void 0 ? void 0 : _a.type) === 'COMPONENT',
        isInstance: ((_b = node.parent) === null || _b === void 0 ? void 0 : _b.type) === 'INSTANCE',
    };
}
/**
 * Check if a text node should be skipped and return the reason.
 * Returns null if the node should not be skipped.
 */
function getSkipReason(node) {
    var _a;
    if (node.type !== 'TEXT') {
        return 'not-text-node';
    }
    const textNode = node;
    if (textNode.locked) {
        return 'locked';
    }
    if (((_a = textNode.parent) === null || _a === void 0 ? void 0 : _a.type) === 'INSTANCE') {
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
function createSkippedLayer(node, reason, details) {
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
async function safeApplyText(node, runs, result) {
    try {
        // Load all unique fonts first
        const seen = new Set();
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
    }
    catch (err) {
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
function summarizeSkipped(skipped) {
    if (skipped.length === 0)
        return '';
    const byReason = {
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
    const parts = [];
    if (byReason.locked > 0)
        parts.push(`${byReason.locked} locked`);
    if (byReason['component-instance'] > 0)
        parts.push(`${byReason['component-instance']} component instances`);
    if (byReason['write-failed'] > 0)
        parts.push(`${byReason['write-failed']} with write errors`);
    if (byReason['font-unavailable'] > 0)
        parts.push(`${byReason['font-unavailable']} with missing fonts`);
    return parts.length > 0 ? `Skipped: ${parts.join(', ')}` : '';
}
/**
 * Create a success message that includes applied and skipped counts.
 */
function formatSuccessMessage(applied, total, skipped) {
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
function formatEmptyScopeMessage(scope) {
    if (scope === 'page') {
        return 'Please select a frame first';
    }
    return 'No text layers found in scope';
}
