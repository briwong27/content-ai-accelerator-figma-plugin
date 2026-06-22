/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />

figma.showUI(__html__, { width: 320, height: 520 });

type Scope = 'selection' | 'page' | 'all';
type Mode = 'translate' | 'stress';
type StressLang = 'de' | 'fi' | 'ar' | 'zh' | 'zh-TW' | 'ja';
type TranslateLang = 'es' | 'fr' | 'de' | 'ja' | 'ar' | 'zh' | 'zh-TW';

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

type PluginMessage = ApplyMessage | UndoMessage | GetApiKeyMessage | SaveApiKeyMessage | RunReportMessage | ResizeMessage;

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

// Arabic: Simulate RTL text complexity by adding Arabic characters as suffix
// Tests how UI handles mixed RTL/LTR text and longer text strings
function expandTextAR(text: string): string {
  const arabicSuffixes = ['ـي', 'ـك', 'ـن', 'ـة', 'ـل'];
  return text
    .split(' ')
    .map((word, i) => (word.length === 0 ? word : word + arabicSuffixes[i % arabicSuffixes.length]))
    .join(' ');
}

// Chinese: Simulate CJK character complexity by adding Chinese characters
// Tests fullwidth character rendering and text wrapping with high stroke count
function expandTextZH(text: string): string {
  const chineseSuffixes = ['字', '中', '文', '系', '統'];
  return text
    .split(' ')
    .map((word, i) => (word.length === 0 ? word : word + chineseSuffixes[i % chineseSuffixes.length]))
    .join(' ');
}

// Japanese: Simulate Japanese complexity by adding Japanese characters
// Tests fullwidth rendering and script mixing (Latin + hiragana/katakana)
function expandTextJA(text: string): string {
  const japaneseSuffixes = ['です', 'ます', 'する', 'いる', 'ある'];
  return text
    .split(' ')
    .map((word, i) => (word.length === 0 ? word : word + japaneseSuffixes[i % japaneseSuffixes.length]))
    .join(' ');
}

function expandText(text: string, lang: StressLang): string {
  if (lang === 'de') return expandTextDE(text);
  if (lang === 'fi') return expandTextFI(text);
  if (lang === 'ar') return expandTextAR(text);
  if (lang === 'zh') return expandTextZH(text);
  if (lang === 'zh-TW') return expandTextZH(text); // Same expansion as simplified
  if (lang === 'ja') return expandTextJA(text);
  return text;
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

// --- Main handlers ---

async function applyLocalization(msg: ApplyMessage): Promise<void> {
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
      const translatedRuns: StyleRun[] = [];

      for (const run of originalRuns) {
        let translatedText: string;
        if (msg.mode === 'stress') {
          translatedText = expandText(run.text, msg.lang as StressLang);
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

  figma.notify(`Applied to ${successCount} of ${nodes.length} text layers.`);
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
  figma.notify(`Restored ${successCount} text layer(s).`);
}

figma.ui.onmessage = async (msg: PluginMessage) => {
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
  } else if (msg.type === 'resize') {
    figma.ui.resize(msg.width, msg.height);
  } else if (msg.type === 'run-report') {
    const scope: Scope = (msg.scope === 'page' || msg.scope === 'all') ? msg.scope : 'selection';
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
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json() as { report: unknown };
      figma.ui.postMessage({ type: 'report-result', raw: JSON.stringify(data.report) });
    } catch (err) {
      figma.ui.postMessage({ type: 'report-error', error: (err as Error).message });
    }
  }
};
