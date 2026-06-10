/// <reference path="./node_modules/@figma/plugin-typings/index.d.ts" />

figma.showUI(__html__, { width: 320, height: 420 });

type Scope = 'selection' | 'page' | 'all';
type Mode = 'translate' | 'stress';
type StressLang = 'de' | 'fi';
type TranslateLang = 'es' | 'fr' | 'de' | 'ja';

interface ApplyMessage {
  type: 'apply';
  scope: Scope;
  mode: Mode;
  lang: StressLang | TranslateLang;
}

interface UndoMessage {
  type: 'undo';
}

type PluginMessage = ApplyMessage | UndoMessage;

// --- Text expansion for stress test ---

function expandTextDE(text: string): string {
  const suffixes = ['ung', 'keit', 'schaft', 'ierung'];
  return text
    .split(' ')
    .map((word, i) => {
      if (word.length === 0) return word;
      const suffix = suffixes[i % suffixes.length];
      const padded = word + suffix;
      return padded;
    })
    .join(' ');
}

function expandTextFI(text: string): string {
  return text
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      // repeat vowels to simulate Finnish agglutination
      return word
        .split('')
        .map((ch) => ('aeiouAEIOU'.includes(ch) ? ch + ch : ch))
        .join('') + 'nen';
    })
    .join(' ');
}

function expandText(text: string, lang: StressLang): string {
  if (lang === 'de') return expandTextDE(text);
  return expandTextFI(text);
}

function stubTranslate(text: string, lang: TranslateLang): string {
  const labels: Record<TranslateLang, string> = {
    es: 'ES', fr: 'FR', de: 'DE', ja: 'JA',
  };
  return `[${labels[lang]}] ${text}`;
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
  if (scope === 'selection') {
    return figma.currentPage.selection.flatMap(collectTextNodes);
  }
  if (scope === 'page') {
    return collectTextNodes(figma.currentPage);
  }
  // all pages
  return figma.root.children.flatMap(collectTextNodes);
}

// --- Snapshot for undo ---

type Snapshot = Record<string, string>;

function saveSnapshot(nodes: TextNode[]): void {
  const snapshot: Snapshot = {};
  for (const node of nodes) {
    snapshot[node.id] = node.characters;
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

// --- Font loading ---

async function loadAllFonts(node: TextNode): Promise<void> {
  const len = node.characters.length;
  const seen = new Set<string>();
  for (let i = 0; i < len; i++) {
    const font = node.getRangeFontName(i, i + 1) as FontName;
    const key = `${font.family}::${font.style}`;
    if (!seen.has(key)) {
      seen.add(key);
      await figma.loadFontAsync(font);
    }
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
      await loadAllFonts(node);
      if (msg.mode === 'stress') {
        node.characters = expandText(node.characters, msg.lang as StressLang);
      } else {
        node.characters = stubTranslate(node.characters, msg.lang as TranslateLang);
      }
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
  for (const [id, originalText] of Object.entries(snapshot)) {
    const node = figma.getNodeById(id) as TextNode | null;
    if (!node || node.type !== 'TEXT') continue;
    try {
      await loadAllFonts(node);
      node.characters = originalText;
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
  }
};
