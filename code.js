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
// Arabic: Add diacritics throughout text to simulate RTL complexity
// Diacritics (fatha, damma, etc.) increase visual weight and test rendering with combining marks
function expandTextAR(text) {
    const diacritics = ['َ', 'ِ', 'ُ', 'ً', 'ٌ', 'ّ', 'ْ'];
    let result = '';
    let diacriticIndex = 0;
    for (let i = 0; i < text.length; i++) {
        result += text[i];
        if (text[i] !== ' ') {
            result += diacritics[diacriticIndex % diacritics.length];
            diacriticIndex++;
        }
    }
    return result;
}
// Chinese: Repeat characters to simulate CJK density and stroke complexity
// Tests fullwidth character rendering and increased text width
function expandTextZH(text) {
    const chineseChars = ['字', '中', '文', '语', '言', '系', '统', '字', '符', '串'];
    let result = '';
    let charIndex = 0;
    for (let i = 0; i < text.length; i++) {
        result += text[i];
        if (text[i] !== ' ') {
            result += chineseChars[charIndex % chineseChars.length];
            charIndex++;
        }
    }
    return result;
}
// Japanese: Add hiragana combining characters to simulate ruby text and script mixing
// Tests mixed Latin + fullwidth script rendering and text height/complexity
function expandTextJA(text) {
    const rubyChars = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ'];
    let result = '';
    let rubyIndex = 0;
    for (let i = 0; i < text.length; i++) {
        result += text[i];
        if (text[i] !== ' ') {
            result += rubyChars[rubyIndex % rubyChars.length];
            rubyIndex++;
        }
    }
    return result;
}
function expandText(text, lang) {
    if (lang === 'de')
        return expandTextDE(text);
    if (lang === 'fi')
        return expandTextFI(text);
    if (lang === 'ar')
        return expandTextAR(text);
    if (lang === 'zh')
        return expandTextZH(text);
    if (lang === 'zh-TW')
        return expandTextZH(text); // Same expansion as simplified
    if (lang === 'ja')
        return expandTextJA(text);
    return text;
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
            const originalRuns = getStyledRuns(node);
            const translatedRuns = [];
            for (const run of originalRuns) {
                let translatedText;
                if (msg.mode === 'stress') {
                    translatedText = expandText(run.text, msg.lang);
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
