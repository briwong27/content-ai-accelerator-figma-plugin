"use strict";
/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />
figma.showUI(__html__, { width: 320, height: 420 });
// --- Text expansion for stress test ---
function expandTextDE(text) {
    const suffixes = ['ung', 'keit', 'schaft', 'ierung'];
    return text
        .split(' ')
        .map((word, i) => {
        if (word.length === 0)
            return word;
        const suffix = suffixes[i % suffixes.length];
        const padded = word + suffix;
        return padded;
    })
        .join(' ');
}
function expandTextFI(text) {
    return text
        .split(' ')
        .map((word) => {
        if (word.length === 0)
            return word;
        // repeat vowels to simulate Finnish agglutination
        return word
            .split('')
            .map((ch) => ('aeiouAEIOU'.includes(ch) ? ch + ch : ch))
            .join('') + 'nen';
    })
        .join(' ');
}
function expandText(text, lang) {
    if (lang === 'de')
        return expandTextDE(text);
    return expandTextFI(text);
}
function stubTranslate(text, lang) {
    const labels = {
        es: 'ES', fr: 'FR', de: 'DE', ja: 'JA',
    };
    return `[${labels[lang]}] ${text}`;
}
// --- Node traversal ---
function collectTextNodes(node) {
    if (node.type === 'TEXT')
        return [node];
    if ('children' in node) {
        return node.children.flatMap(collectTextNodes);
    }
    return [];
}
function getScopedNodes(scope) {
    if (scope === 'selection') {
        return figma.currentPage.selection.flatMap(collectTextNodes);
    }
    if (scope === 'page') {
        return collectTextNodes(figma.currentPage);
    }
    // all pages
    return figma.root.children.flatMap(collectTextNodes);
}
function saveSnapshot(nodes) {
    const snapshot = {};
    for (const node of nodes) {
        snapshot[node.id] = node.characters;
    }
    figma.root.setPluginData('localization_snapshot', JSON.stringify(snapshot));
}
function loadSnapshot() {
    const raw = figma.root.getPluginData('localization_snapshot');
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch (_a) {
        return null;
    }
}
// --- Main handlers ---
async function applyLocalization(msg) {
    const nodes = getScopedNodes(msg.scope);
    if (nodes.length === 0) {
        figma.notify('No text layers found in scope.');
        return;
    }
    saveSnapshot(nodes);
    let successCount = 0;
    for (const node of nodes) {
        try {
            await figma.loadFontAsync(node.fontName);
            if (msg.mode === 'stress') {
                node.characters = expandText(node.characters, msg.lang);
            }
            else {
                node.characters = stubTranslate(node.characters, msg.lang);
            }
            successCount++;
        }
        catch (err) {
            console.error(`Skipped node ${node.id}:`, err);
        }
    }
    figma.notify(`Applied to ${successCount} of ${nodes.length} text layers.`);
}
async function undoLocalization() {
    const snapshot = loadSnapshot();
    if (!snapshot) {
        figma.notify('Nothing to undo.');
        return;
    }
    let successCount = 0;
    for (const [id, originalText] of Object.entries(snapshot)) {
        const node = figma.getNodeById(id);
        if (!node || node.type !== 'TEXT')
            continue;
        try {
            await figma.loadFontAsync(node.fontName);
            node.characters = originalText;
            successCount++;
        }
        catch (err) {
            console.error(`Could not restore node ${id}:`, err);
        }
    }
    figma.root.setPluginData('localization_snapshot', '');
    figma.notify(`Restored ${successCount} text layer(s).`);
}
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'apply') {
        await applyLocalization(msg);
    }
    else if (msg.type === 'undo') {
        await undoLocalization();
    }
};
