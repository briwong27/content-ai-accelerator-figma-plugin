/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />

figma.showUI(__html__, { width: 320, height: 520 });

function sendPluginError(tab: string): void {
  figma.ui.postMessage({ type: 'plugin-error', tab });
}

function tabForMessageType(type: string): string | null {
  switch (type) {
    case 'apply':
    case 'undo':
      return 'localize';
    case 'find-replace':
      return 'replace';
    case 'terminology':
      return 'terms';
    case 'counter':
      return 'counter';
    case 'load-accessibility-elements':
    case 'save-accessibility-labels':
      return 'accessibility';
    case 'run-report':
      return 'report';
    default:
      return null;
  }
}

type Scope = 'selection' | 'page' | 'all';
type Mode = 'translate' | 'stress';
type StressLang = 'de' | 'fi' | 'ar' | 'zh' | 'zh-TW' | 'ja';
type TranslateLang = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'ar' | 'zh' | 'zh-TW';

interface ApplyMessage {
  type: 'apply';
  scope: Scope;
  mode: Mode;
  lang: StressLang | TranslateLang;
}

interface UndoMessage {
  type: 'undo';
}

interface GetApiKeyMessage {
  type: 'get-api-key';
}

interface SaveApiKeyMessage {
  type: 'save-api-key';
  key: string;
}

interface GetTermRulesMessage {
  type: 'get-term-rules';
}

interface SaveTermRulesMessage {
  type: 'save-term-rules';
  rules: string;
}

interface RunReportMessage {
  type: 'run-report';
  scope: 'selection' | 'page' | 'all';
  systemPrompt: string;
}

interface ResizeMessage {
  type: 'resize';
  width: number;
  height: number;
}

interface FindReplaceMessage {
  type: 'find-replace';
  action: 'count' | 'replace';
  scope: Scope;
  find: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
}

interface TermRule {
  find: string;
  replace: string;
}

interface TerminologyMessage {
  type: 'terminology';
  action: 'scan' | 'fix';
  scope: Scope;
  rules: TermRule[];
}

interface CounterMessage {
  type: 'counter';
  scope: Scope;
}

interface GetStyleguideMessage {
  type: 'get-styleguide';
}

interface SaveStyleguideMessage {
  type: 'save-styleguide';
  styleguide: string;
  customRules?: string;
}

interface LoadAccessibilityElementsMessage {
  type: 'load-accessibility-elements';
  scope: Scope;
}

interface SaveAccessibilityLabelsMessage {
  type: 'save-accessibility-labels';
  labels: Record<string, { label: string; hint: string; role: string; altText: string }>;
}

type PluginMessage = ApplyMessage | UndoMessage | GetApiKeyMessage | SaveApiKeyMessage | GetTermRulesMessage | SaveTermRulesMessage | RunReportMessage | ResizeMessage | FindReplaceMessage | TerminologyMessage | CounterMessage | GetStyleguideMessage | SaveStyleguideMessage | LoadAccessibilityElementsMessage | SaveAccessibilityLabelsMessage;

// --- Style runs ---
// A run is a contiguous segment of text where fontName and fontSize are uniform.

interface StyleRun {
  text: string;
  fontName: FontName;
  fontSize: number;
}

function getStyledRuns(node: TextNode): StyleRun[] {
  const len = node.characters.length;
  if (len === 0) return [];

  const runs: StyleRun[] = [];
  let start = 0;
  let curFont = node.getRangeFontName(0, 1) as FontName;
  let curSize = node.getRangeFontSize(0, 1) as number;

  for (let i = 1; i <= len; i++) {
    const atEnd = i === len;
    const font = atEnd ? curFont : node.getRangeFontName(i, i + 1) as FontName;
    const size = atEnd ? curSize : node.getRangeFontSize(i, i + 1) as number;
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

async function applyStyledRuns(node: TextNode, runs: StyleRun[]): Promise<void> {
  // Load all unique fonts first
  const seen = new Set<string>();
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

function expandTextDE(text: string): string {
  const suffixes = ['ung', 'keit', 'schaft', 'ierung'];
  return text
    .split(' ')
    .map((word, i) => (word.length === 0 ? word : word + suffixes[i % suffixes.length]))
    .join(' ');
}

function expandTextFI(text: string): string {
  return text
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      return word.split('').map((ch) => ('aeiouAEIOU'.includes(ch) ? ch + ch : ch)).join('') + 'nen';
    })
    .join(' ');
}

// Arabic: After translating to real Arabic, add diacritics (tashkeel) to letters.
// This keeps the text authentic Arabic while increasing visual density and
// testing how combining marks render and affect line height.
function addArabicDiacritics(text: string): string {
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
function lengthenCJK(text: string): string {
  let result = '';
  for (const ch of text) {
    result += ch;
    if (ch.trim() !== '') result += ch;
  }
  return result;
}

// Stress text: German/Finnish use local pseudo-expansion (Latin script, no
// translation needed). Arabic/Chinese/Japanese are translated to the real
// language first, then expanded so the output is genuine script under stress.
async function stressText(text: string, lang: StressLang): Promise<string> {
  if (lang === 'de') return expandTextDE(text);
  if (lang === 'fi') return expandTextFI(text);

  if (!text.trim()) return text;
  const translated = await translateText(text, lang as TranslateLang);
  if (lang === 'ar') return addArabicDiacritics(translated);
  return lengthenCJK(translated); // zh, zh-TW, ja
}

// --- Translation ---

async function translateText(text: string, lang: TranslateLang): Promise<string> {
  if (!text.trim()) return text;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${lang}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translation request failed: ${res.status}`);
  const data = await res.json() as { responseData: { translatedText: string }; responseStatus: number };
  if (data.responseStatus !== 200) throw new Error(`Translation error: ${data.responseStatus}`);
  return data.responseData.translatedText;
}

// --- Find & replace engine ---

interface ReplaceOpts {
  matchCase: boolean;
  wholeWord: boolean;
  preserveCase: boolean; // capitalize replacement when the match is capitalized
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyReplace(text: string, find: string, replace: string, opts: ReplaceOpts): { result: string; count: number } {
  if (!find) return { result: text, count: 0 };
  let pattern = escapeRegExp(find);
  if (opts.wholeWord) pattern = `\\b${pattern}\\b`;
  const re = new RegExp(pattern, 'g' + (opts.matchCase ? '' : 'i'));
  let count = 0;
  const result = text.replace(re, (match) => {
    count++;
    const first = match.charAt(0);
    if (opts.preserveCase && first && first === first.toUpperCase() && first !== first.toLowerCase()) {
      return replace.charAt(0).toUpperCase() + replace.slice(1);
    }
    return replace;
  });
  return { result, count };
}

// Count occurrences across nodes without mutating anything.
function countMatches(nodes: TextNode[], find: string, replace: string, opts: ReplaceOpts): number {
  let count = 0;
  for (const node of nodes) {
    count += applyReplace(node.characters, find, replace, opts).count;
  }
  return count;
}

// Apply one or more replacement rules to every node, preserving per-run styling.
// Returns total replacements made and how many layers changed.
async function replaceInNodes(nodes: TextNode[], rules: TermRule[], opts: ReplaceOpts): Promise<{ count: number; changedNodes: number }> {
  let count = 0;
  let changedNodes = 0;
  for (const node of nodes) {
    try {
      const runs = getStyledRuns(node);
      let nodeCount = 0;
      const newRuns = runs.map((run) => {
        let text = run.text;
        for (const rule of rules) {
          if (!rule.find) continue;
          const res = applyReplace(text, rule.find, rule.replace, opts);
          text = res.result;
          nodeCount += res.count;
        }
        return { ...run, text };
      });
      if (nodeCount > 0) {
        await applyStyledRuns(node, newRuns);
        count += nodeCount;
        changedNodes++;
      }
    } catch (err) {
      console.error(`Skipped node ${node.id}:`, err);
    }
  }
  return { count, changedNodes };
}

// --- Node traversal ---

function collectTextNodes(node: BaseNode): TextNode[] {
  if (node.type === 'TEXT') return [node as TextNode];
  if ('children' in node) {
    return (node as ChildrenMixin).children.flatMap(collectTextNodes);
  }
  return [];
}

function getScopedNodes(scope: Scope): TextNode[] {
  if (scope === 'selection') return figma.currentPage.selection.flatMap(collectTextNodes);
  if (scope === 'page') return collectTextNodes(figma.currentPage);
  return figma.root.children.flatMap(collectTextNodes);
}

// --- Snapshot for undo ---

interface NodeSnapshot {
  runs: StyleRun[];
  textAutoResize: TextNode['textAutoResize'];
}

type Snapshot = Record<string, NodeSnapshot>;

function saveSnapshot(nodes: TextNode[]): void {
  const snapshot: Snapshot = {};
  for (const node of nodes) {
    snapshot[node.id] = {
      runs: getStyledRuns(node),
      textAutoResize: node.textAutoResize,
    };
  }
  figma.root.setPluginData('localization_snapshot', JSON.stringify(snapshot));
}

function loadSnapshot(): Snapshot | null {
  const raw = figma.root.getPluginData('localization_snapshot');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

// --- Original (English) store ---
// Unlike the single-step undo snapshot, this records each node's pristine
// state the first time it is localized and never overwrites it. This lets the
// "English" option restore the original text even after many stress tests.

function loadOriginals(): Snapshot {
  const raw = figma.root.getPluginData('localization_original');
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    return {};
  }
}

function recordOriginals(nodes: TextNode[]): void {
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

async function applyLocalization(msg: ApplyMessage): Promise<void> {
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
      const translatedRuns: StyleRun[] = [];

      for (const run of originalRuns) {
        let translatedText: string;
        if (msg.mode === 'stress') {
          translatedText = await stressText(run.text, msg.lang as StressLang);
        } else {
          translatedText = await translateText(run.text, msg.lang as TranslateLang);
        }
        translatedRuns.push({ ...run, text: translatedText });
      }

      await applyStyledRuns(node, translatedRuns);
      successCount++;
    } catch (err) {
      console.error(`Skipped node ${node.id}:`, err);
    }
  }

  if (successCount === 0) {
    sendPluginError('localize');
  } else {
    figma.notify(`Applied to ${successCount} of ${nodes.length} text layers.`);
  }
}

async function restoreToEnglish(nodes: TextNode[]): Promise<void> {
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
    } catch (err) {
      console.error(`Could not restore node ${node.id} to English:`, err);
    }
  }

  if (restored === 0 && missing === 0 && nodes.length > 0) {
    sendPluginError('localize');
  } else if (restored === 0 && missing > 0) {
    figma.notify('No original English text on record for these layers.');
  } else {
    figma.notify(`Restored ${restored} layer(s) to English.`);
  }
}

async function undoLocalization(): Promise<void> {
  const snapshot = loadSnapshot();
  if (!snapshot) {
    figma.notify('Nothing to undo.');
    return;
  }

  let successCount = 0;
  for (const [id, nodeSnapshot] of Object.entries(snapshot)) {
    const node = figma.getNodeById(id) as TextNode | null;
    if (!node || node.type !== 'TEXT') continue;
    try {
      node.textAutoResize = nodeSnapshot.textAutoResize;
      await applyStyledRuns(node, nodeSnapshot.runs);
      successCount++;
    } catch (err) {
      console.error(`Could not restore node ${id}:`, err);
    }
  }

  figma.root.setPluginData('localization_snapshot', '');
  if (successCount === 0 && Object.keys(snapshot).length > 0) {
    sendPluginError('localize');
  } else {
    figma.notify(`Restored ${successCount} text layer(s).`);
  }
}

figma.ui.onmessage = async (msg: PluginMessage) => {
  try {
  if (msg.type === 'apply') {
    await applyLocalization(msg);
  } else if (msg.type === 'undo') {
    await undoLocalization();
  } else if (msg.type === 'get-api-key') {
    const key = await figma.clientStorage.getAsync('anthropic-api-key') as string | undefined;
    figma.ui.postMessage({ type: 'api-key', key: key || '' });
  } else if (msg.type === 'save-api-key') {
    await figma.clientStorage.setAsync('anthropic-api-key', msg.key);
    figma.ui.postMessage({ type: 'api-key-saved' });
  } else if (msg.type === 'get-term-rules') {
    const rules = await figma.clientStorage.getAsync('terminology-rules') as string | undefined;
    figma.ui.postMessage({ type: 'term-rules', rules: rules || '' });
  } else if (msg.type === 'save-term-rules') {
    await figma.clientStorage.setAsync('terminology-rules', msg.rules);
  } else if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  } else if (msg.type === 'find-replace') {
    const nodes = getScopedNodes(msg.scope);
    if (nodes.length === 0) {
      figma.ui.postMessage({ type: 'fr-result', mode: msg.action, count: 0, noScope: true });
      return;
    }
    const opts: ReplaceOpts = { matchCase: msg.matchCase, wholeWord: msg.wholeWord, preserveCase: !msg.matchCase };

    if (msg.action === 'count') {
      const count = countMatches(nodes, msg.find, msg.replace, opts);
      figma.ui.postMessage({ type: 'fr-result', mode: 'count', count });
      return;
    }

    saveSnapshot(nodes);
    const { count, changedNodes } = await replaceInNodes(nodes, [{ find: msg.find, replace: msg.replace }], opts);
    figma.notify(`Replaced ${count} occurrence(s) in ${changedNodes} layer(s).`);
    figma.ui.postMessage({ type: 'fr-result', mode: 'replace', count, nodes: changedNodes });
  } else if (msg.type === 'terminology') {
    const nodes = getScopedNodes(msg.scope);
    if (nodes.length === 0) {
      figma.ui.postMessage({ type: 'term-result', mode: msg.action, violations: [], count: 0, noScope: true });
      return;
    }
    const opts: ReplaceOpts = { matchCase: false, wholeWord: true, preserveCase: true };

    if (msg.action === 'scan') {
      const violations: Array<{ string: string; layer: string; term: string; suggestion: string; count: number }> = [];
      for (const node of nodes) {
        for (const rule of msg.rules) {
          if (!rule.find) continue;
          const c = applyReplace(node.characters, rule.find, rule.replace, opts).count;
          if (c > 0) {
            violations.push({ string: node.characters, layer: node.name, term: rule.find, suggestion: rule.replace, count: c });
          }
        }
      }
      const total = violations.reduce((a, v) => a + v.count, 0);
      figma.ui.postMessage({ type: 'term-result', mode: 'scan', violations, count: total });
      return;
    }

    saveSnapshot(nodes);
    const { count, changedNodes } = await replaceInNodes(nodes, msg.rules, opts);
    figma.notify(`Fixed ${count} term(s) in ${changedNodes} layer(s).`);
    figma.ui.postMessage({ type: 'term-result', mode: 'fix', violations: [], count, nodes: changedNodes });
  } else if (msg.type === 'run-report') {
    const scope: Scope = (msg.scope === 'page' || msg.scope === 'all') ? msg.scope : 'selection';
    const nodes = getScopedNodes(scope);

    if (nodes.length === 0) {
      console.error('No text found in the selected scope.');
      sendPluginError('report');
      return;
    }

    const apiKey = await figma.clientStorage.getAsync('anthropic-api-key') as string | undefined;
    if (!apiKey) {
      console.error('No API key configured. Please enter your Anthropic API key in the Review tab.');
      figma.ui.postMessage({ type: 'report-error', error: 'No API key configured. Please enter your Anthropic API key in the Review tab.' });
      return;
    }

    console.log('API key retrieved, length:', apiKey.length, 'starts with:', apiKey.substring(0, 10));

    const texts = nodes.map(n => n.characters);

    try {
      console.log('Starting report analysis with', texts.length, 'text nodes');
      console.log('Sending to http://localhost:3000/api/analyze-plugin');

      const res = await fetch('http://localhost:3000/api/analyze-plugin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts,
          systemPrompt: msg.systemPrompt,
          apiKey
        })
      });

      console.log('Response status:', res.status);

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
        const errorMsg = err.error?.message || `HTTP ${res.status}`;
        throw new Error(errorMsg);
      }

      const data = await res.json();
      console.log('Response JSON parsed:', JSON.stringify(data).substring(0, 100));

      const report = (data as any).report;
      if (!report) {
        console.error('No report in response:', JSON.stringify(data));
        throw new Error((data as any).error || 'Empty response from server');
      }
      figma.ui.postMessage({ type: 'report-result', raw: report });
    } catch (err) {
      let errorMsg = 'Unknown error';
      let errorDetails = '';

      if (err instanceof Error) {
        errorMsg = err.message;
        errorDetails = err.stack || '';
      } else if (typeof err === 'object' && err !== null) {
        errorMsg = JSON.stringify(err);
        errorDetails = JSON.stringify(err, null, 2);
      } else {
        errorMsg = String(err);
      }

      console.error('Report analysis failed:', errorMsg);
      console.error('Error details:', errorDetails);
      console.error('Full error object:', err);

      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('fetch')) {
        figma.ui.postMessage({ type: 'report-error', error: 'Network error: Could not reach the API. Check your internet connection.' });
      } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
        figma.ui.postMessage({ type: 'report-error', error: 'API Error: Invalid API key. Check that your key is correct.' });
      } else {
        figma.ui.postMessage({ type: 'report-error', error: `API Error: ${errorMsg}` });
      }
    }
  } else if (msg.type === 'counter') {
    const nodes = getScopedNodes(msg.scope);
    if (nodes.length === 0) {
      figma.ui.postMessage({ type: 'counter-result', chars: 0, words: 0, noScope: true });
      return;
    }

    let totalChars = 0;
    let totalWords = 0;

    for (const node of nodes) {
      const text = node.characters;
      totalChars += text.length;
      totalWords += text.split(/\s+/).filter(word => word.length > 0).length;
    }

    figma.ui.postMessage({ type: 'counter-result', chars: totalChars, words: totalWords });
  } else if (msg.type === 'get-styleguide') {
    const styleguide = await figma.clientStorage.getAsync('styleguide') as string | undefined;
    const customRules = await figma.clientStorage.getAsync('custom-styleguide-rules') as string | undefined;
    figma.ui.postMessage({ type: 'styleguide', styleguide: styleguide || 'shopify', customRules: customRules || '' });
  } else if (msg.type === 'save-styleguide') {
    await figma.clientStorage.setAsync('styleguide', msg.styleguide);
    if (msg.customRules) {
      await figma.clientStorage.setAsync('custom-styleguide-rules', msg.customRules);
    }
    figma.ui.postMessage({ type: 'styleguide-saved' });
  } else if (msg.type === 'load-accessibility-elements') {
    const nodes = getScopedNodes(msg.scope);
    const elements: Array<{ id: string; name: string; type: string; label: string; hint: string; role: string; altText: string }> = [];

    for (const node of nodes) {
      const pluginData = node.getPluginData('accessibility');
      let data = { label: '', hint: '', role: '', altText: '' };
      if (pluginData) {
        try {
          data = JSON.parse(pluginData);
        } catch {
          data = { label: '', hint: '', role: '', altText: '' };
        }
      }
      elements.push({
        id: node.id,
        name: node.name,
        type: 'text',
        ...data
      });
    }

    figma.ui.postMessage({ type: 'accessibility-elements', elements, count: elements.length });
  } else if (msg.type === 'save-accessibility-labels') {
    let saved = 0;
    const nodes = getScopedNodes('selection');

    for (const node of nodes) {
      if (msg.labels[node.id]) {
        const data = msg.labels[node.id];
        node.setPluginData('accessibility', JSON.stringify(data));
        saved++;
      }
    }

    figma.notify(`Saved accessibility labels for ${saved} element(s).`);
    figma.ui.postMessage({ type: 'accessibility-saved', saved });
  }
  } catch (err) {
    console.error('Unhandled plugin error:', err);
    const tab = tabForMessageType(msg.type);
    if (tab) sendPluginError(tab);
  }
};
