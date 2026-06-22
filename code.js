"use strict";
/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />
figma.showUI(__html__, { width: 320, height: 520 });
function getStyledRuns(node) {
    const len = node.characters.length;
    if (len === 0)
        return [];
    const runs = [];
    let start = 0;
    let curFont = node.getRangeFontName(0, 1);
    let curSize = node.getRangeFontSize(0, 1);
    for (let i = 1; i <= len; i++) {
        const atEnd = i === len;
        const font = atEnd ? curFont : node.getRangeFontName(i, i + 1);
        const size = atEnd ? curSize : node.getRangeFontSize(i, i + 1);
        const changed = font.family !== curFont.family || font.style !== curFont.style || size !== curSize;
        if (atEnd || changed) {
            runs.push({ text: node.characters.slice(start, i), fontName: curFont, fontSize: curSize });
            start = i;
            curFont = font;
            curSize = size;
        }
    }
    return runs;
}
async function applyStyledRuns(node, runs) {
    // Load all unique fonts first
    const seen = new Set();
    for (const run of runs) {
        const key = `${run.fontName.family}::${run.fontName.style}`;
        if (!seen.has(key)) {
            seen.add(key);
            await figma.loadFontAsync(run.fontName);
        }
    }
    // Allow height to grow so translated text wraps instead of clipping
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
}
// --- Text expansion for stress test ---
function expandTextDE(text) {
    const suffixes = ['ung', 'keit', 'schaft', 'ierung'];
    return text
        .split(' ')
        .map((word, i) => (word.length === 0 ? word : word + suffixes[i % suffixes.length]))
        .join(' ');
}
function expandTextFI(text) {
    return text
        .split(' ')
        .map((word) => {
        if (word.length === 0)
            return word;
        return word.split('').map((ch) => ('aeiouAEIOU'.includes(ch) ? ch + ch : ch)).join('') + 'nen';
    })
        .join(' ');
}
// Arabic: After translating to real Arabic, add diacritics (tashkeel) to letters.
// This keeps the text authentic Arabic while increasing visual density and
// testing how combining marks render and affect line height.
function addArabicDiacritics(text) {
    const diacritics = ['َ', 'ِ', 'ُ', 'ً', 'ٌ', 'ّ', 'ْ'];
    let result = '';
    let i = 0;
    for (const ch of text) {
        result += ch;
        const code = ch.charCodeAt(0);
        // Only decorate actual Arabic letters (Unicode 0x0600–0x06FF)
        if (code >= 0x0600 && code <= 0x06FF) {
            result += diacritics[i % diacritics.length];
            i++;
        }
    }
    return result;
}
// CJK (Chinese/Japanese): After translating, double each character to push
// text length/width to a worst-case while staying in the target script.
function lengthenCJK(text) {
    let result = '';
    for (const ch of text) {
        result += ch;
        if (ch.trim() !== '')
            result += ch;
    }
    return result;
}
// Stress text: German/Finnish use local pseudo-expansion (Latin script, no
// translation needed). Arabic/Chinese/Japanese are translated to the real
// language first, then expanded so the output is genuine script under stress.
async function stressText(text, lang) {
    if (lang === 'de')
        return expandTextDE(text);
    if (lang === 'fi')
        return expandTextFI(text);
    if (!text.trim())
        return text;
    const translated = await translateText(text, lang);
    if (lang === 'ar')
        return addArabicDiacritics(translated);
    return lengthenCJK(translated); // zh, zh-TW, ja
}
// --- Translation ---
async function translateText(text, lang) {
    if (!text.trim())
        return text;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${lang}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Translation request failed: ${res.status}`);
    const data = await res.json();
    if (data.responseStatus !== 200)
        throw new Error(`Translation error: ${data.responseStatus}`);
    return data.responseData.translatedText;
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
    if (scope === 'selection')
        return figma.currentPage.selection.flatMap(collectTextNodes);
    if (scope === 'page')
        return collectTextNodes(figma.currentPage);
    return figma.root.children.flatMap(collectTextNodes);
}
function saveSnapshot(nodes) {
    const snapshot = {};
    for (const node of nodes) {
        snapshot[node.id] = {
            runs: getStyledRuns(node),
            textAutoResize: node.textAutoResize,
        };
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
// --- Original (English) store ---
// Unlike the single-step undo snapshot, this records each node's pristine
// state the first time it is localized and never overwrites it. This lets the
// "English" option restore the original text even after many stress tests.
function loadOriginals() {
    const raw = figma.root.getPluginData('localization_original');
    if (!raw)
        return {};
    try {
        return JSON.parse(raw);
    }
    catch (_a) {
        return {};
    }
}
function recordOriginals(nodes) {
    const originals = loadOriginals();
    let changed = false;
    for (const node of nodes) {
        if (!originals[node.id]) {
            originals[node.id] = {
                runs: getStyledRuns(node),
                textAutoResize: node.textAutoResize,
            };
            changed = true;
        }
    }
    if (changed) {
        figma.root.setPluginData('localization_original', JSON.stringify(originals));
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
    // "English" restores each node to its recorded original instead of translating.
    if (msg.mode === 'translate' && msg.lang === 'en') {
        await restoreToEnglish(nodes);
        return;
    }
    // Capture pristine English the first time each node is localized.
    recordOriginals(nodes);
    let successCount = 0;
    for (const node of nodes) {
        try {
            const originalRuns = getStyledRuns(node);
            const translatedRuns = [];
            for (const run of originalRuns) {
                let translatedText;
                if (msg.mode === 'stress') {
                    translatedText = await stressText(run.text, msg.lang);
                }
                else {
                    translatedText = await translateText(run.text, msg.lang);
                }
                translatedRuns.push(Object.assign(Object.assign({}, run), { text: translatedText }));
            }
            await applyStyledRuns(node, translatedRuns);
            successCount++;
        }
        catch (err) {
            console.error(`Skipped node ${node.id}:`, err);
        }
    }
    figma.notify(`Applied to ${successCount} of ${nodes.length} text layers.`);
}
async function restoreToEnglish(nodes) {
    const originals = loadOriginals();
    let restored = 0;
    let missing = 0;
    for (const node of nodes) {
        const original = originals[node.id];
        if (!original) {
            missing++;
            continue;
        }
        try {
            node.textAutoResize = original.textAutoResize;
            await applyStyledRuns(node, original.runs);
            restored++;
        }
        catch (err) {
            console.error(`Could not restore node ${node.id} to English:`, err);
        }
    }
    if (restored === 0 && missing > 0) {
        figma.notify('No original English text on record for these layers.');
    }
    else {
        figma.notify(`Restored ${restored} layer(s) to English.`);
    }
}
async function undoLocalization() {
    const snapshot = loadSnapshot();
    if (!snapshot) {
        figma.notify('Nothing to undo.');
        return;
    }
    let successCount = 0;
    for (const [id, nodeSnapshot] of Object.entries(snapshot)) {
        const node = figma.getNodeById(id);
        if (!node || node.type !== 'TEXT')
            continue;
        try {
            node.textAutoResize = nodeSnapshot.textAutoResize;
            await applyStyledRuns(node, nodeSnapshot.runs);
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
    else if (msg.type === 'get-api-key') {
        const key = await figma.clientStorage.getAsync('anthropic-api-key');
        figma.ui.postMessage({ type: 'api-key', key: key || '' });
    }
    else if (msg.type === 'save-api-key') {
        await figma.clientStorage.setAsync('anthropic-api-key', msg.key);
        figma.ui.postMessage({ type: 'api-key-saved' });
    }
    else if (msg.type === 'resize') {
        figma.ui.resize(msg.width, msg.height);
    }
    else if (msg.type === 'run-report') {
        const scope = (msg.scope === 'page' || msg.scope === 'all') ? msg.scope : 'selection';
        const nodes = getScopedNodes(scope);
        if (nodes.length === 0) {
            figma.ui.postMessage({ type: 'report-error', error: 'No text found in the selected scope.' });
            return;
        }
        const texts = nodes.map(n => n.characters);
        try {
            const res = await fetch('http://localhost:3000/api/analyze-plugin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts, systemPrompt: msg.systemPrompt })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Server error ${res.status}`);
            }
            const data = await res.json();
            figma.ui.postMessage({ type: 'report-result', raw: JSON.stringify(data.report) });
        }
        catch (err) {
            figma.ui.postMessage({ type: 'report-error', error: err.message });
        }
    }
};
