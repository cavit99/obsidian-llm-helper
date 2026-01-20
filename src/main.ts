import { Editor, Notice, Plugin } from "obsidian";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import type { ApplyMode, ObsidianAiLlmHelperSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { ObsidianAiLlmHelperSettingTab } from "./settings";
import { PromptModal } from "./promptModal";
import { generateAiText } from "./openai";

const CONTEXT_WINDOW_CHARS = 500; // fixed per side, plus full document is always sent.

type HighlightSpec = { from: number; to: number };
const addHighlightEffect = StateEffect.define<HighlightSpec>();
const clearHighlightEffect = StateEffect.define<HighlightSpec>();
const highlightMark = Decoration.mark({ class: "obsidian-llm-helper-flash" });
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let deco = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(addHighlightEffect)) {
        deco = deco.update({ add: [highlightMark.range(e.value.from, e.value.to)] });
      } else if (e.is(clearHighlightEffect)) {
        const { from, to } = e.value;
        deco = deco.update({
          filter: (a, b) => !(a === from && b === to)
        });
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f)
});

function getListLineInfo(line: string): { prefix: string; indent: string; marker: string; isStub: boolean } | null {
  const match = line.match(/^(\s*)([-*+]|(?:\d+\.))\s*(.*)$/);
  if (!match) return null;

  const indent = match[1] ?? "";
  const marker = match[2] ?? "";
  const rest = match[3] ?? "";

  return {
    prefix: `${indent}${marker} `,
    indent,
    marker,
    isStub: rest.trim().length === 0
  };
}

function normalizeListText(text: string, stubIndent: string, stubMarker: string): string {
  const lines = text.split("\n");
  const normalized: string[] = [];
  const basePrefix = `${stubIndent}${stubMarker} `;

  lines.forEach((line, idx) => {
    if (!line.trim()) {
      normalized.push(basePrefix.trimEnd());
      return;
    }

    const match = line.match(/^(\s*)([-*+]|(?:\d+\.))\s+(.*)$/);
    if (idx === 0) {
      const content = match ? match[3] : line.trim();
      normalized.push(`${basePrefix}${content}`.trimEnd());
      return;
    }

    if (match) {
      const extraIndent = match[1] ?? "";
      const marker = match[2];
      const content = match[3];
      normalized.push(`${stubIndent}${extraIndent}${marker} ${content}`.trimEnd());
      return;
    }

    // Continuation line without a marker: align under the text column.
    normalized.push(`${basePrefix}${line.trimEnd()}`);
  });

  return normalized.join("\n");
}

function getBlockquotePrefix(line: string): string | null {
  const match = line.match(/^(\s*>+\s?)/);
  return match ? match[1] : null;
}

function applyBlockquotePrefix(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => {
      const stripped = line.replace(/^\s*>+\s?/, "");
      return `${prefix}${stripped}`;
    })
    .join("\n");
}

function isInsideCodeFence(doc: string, currentLine: number): boolean {
  const lines = doc.split("\n");
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*(```|~~~)/);
    if (match) {
      const marker = match[1];
      if (!fence) fence = marker;
      else if (fence === marker) {
        if (i >= currentLine) return true; // cursor on closing fence counts as inside
        fence = null;
      }
    }
    if (i === currentLine) break;
  }
  return fence !== null;
}

function stripOuterCodeFence(text: string): string {
  const lines = text.split("\n");
  if (lines.length < 2) return text;

  const first = lines[0].match(/^\s*(```|~~~)/);
  const last = lines[lines.length - 1].match(/^\s*(```|~~~)/);

  if (first && last && first[1] === last[1]) {
    return lines.slice(1, -1).join("\n");
  }
  return text;
}

function findFenceBounds(docLines: string[], lineIndex: number): { start: number; end: number } | null {
  let start = -1;
  for (let i = lineIndex; i >= 0; i--) {
    if (/^\s*(```|~~~)/.test(docLines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  let end = -1;
  for (let i = lineIndex; i < docLines.length; i++) {
    if (/^\s*(```|~~~)/.test(docLines[i] ?? "")) {
      end = i;
      break;
    }
  }

  if (end === -1 || end === start) return null;
  return { start, end };
}

function trimOuterBlankLines(text: string, trimStart: boolean, trimEnd: boolean): string {
  let result = text;
  if (trimStart) result = result.replace(/^\n+/, "");
  if (trimEnd) result = result.replace(/\n+$/, "");
  return result;
}

function normalizeParagraphSpacing(content: string, docLines: string[], lineIndex: number): string {
  const line = docLines[lineIndex] ?? "";
  if (line.trim().length !== 0) return content;

  const prevLine = lineIndex > 0 ? docLines[lineIndex - 1] ?? "" : "";
  const nextLine = lineIndex + 1 < docLines.length ? docLines[lineIndex + 1] ?? "" : "";
  const prevHasText = prevLine.trim().length > 0;
  const nextHasText = nextLine.trim().length > 0;
  if (!prevHasText && !nextHasText) return content;

  let body = content;
  if (prevHasText) body = body.replace(/^\n+/, "\n");
  body = body.replace(/\n+$/, "\n");

  if (prevHasText && !body.startsWith("\n")) body = `\n${body}`;
  if (nextHasText && !body.endsWith("\n")) body = `${body}\n`;

  return body;
}

export default class ObsidianAiLlmHelperPlugin extends Plugin {
  settings: ObsidianAiLlmHelperSettings = DEFAULT_SETTINGS;
  private statusBarEl?: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ObsidianAiLlmHelperSettingTab(this.app, this));
    this.registerEditorExtension([highlightField]);

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("obsidian-llm-helper-statusbar");
    this.statusBarEl.addClass("obsidian-llm-helper-hidden");

    // Single command: ask AI; mode is inferred from selection (replace if selected, otherwise insert).
    this.addCommand({
      id: "ask-ai",
      name: "Ask AI…",
      editorCallback: (editor: Editor) => {
        new PromptModal(this.app, this, editor).open();
      }
    });

    // Editor context menu integration: subscribe to editor-menu workspace event. :contentReference[oaicite:4]{index=4}
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor: Editor) => {
        menu.addItem((item) => {
          item.setTitle("Ask AI…");
          item.onClick(() => {
            new PromptModal(this.app, this, editor).open();
          });
        });
      })
    );
  }

  onunload(): void {
    // nothing
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private setBusy(on: boolean, message = "Running AI edit…"): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.toggleClass("obsidian-llm-helper-hidden", !on);
    if (on) this.statusBarEl.textContent = message;
  }

  private highlightRange(editor: Editor, fromOffset: number, toOffset: number): void {
    const view = (editor as any).cm as EditorView | undefined;
    if (!view) return;
    const doc = view.state.doc;
    const clamp = (n: number) => Math.max(0, Math.min(n, doc.length));
    const from = clamp(Math.min(fromOffset, toOffset));
    const to = clamp(Math.max(fromOffset, toOffset));
    if (to <= from) return;

    const spec: HighlightSpec = { from, to };
    view.dispatch({ effects: addHighlightEffect.of(spec) });
    window.setTimeout(() => {
      if (!view.state.field(highlightField, false)) return;
      view.dispatch({ effects: clearHighlightEffect.of(spec) });
    }, 1200);
  }

  async runAiEdit(editor: Editor, mode: ApplyMode, userPrompt: string): Promise<void> {
    const apiKey = this.settings.openAiSecretId?.trim() ? this.app.secretStorage.getSecret(this.settings.openAiSecretId) : "";
    const apiBaseUrl = this.settings.apiBaseUrl?.trim() || DEFAULT_SETTINGS.apiBaseUrl;
    const isOpenAiBase = apiBaseUrl.toLowerCase().includes("openai.com");
    if (isOpenAiBase && !apiKey) throw new Error("Missing API key for OpenAI base URL.");

    const model = (this.settings.model || DEFAULT_SETTINGS.model).trim();

    const doc = editor.getValue(); // current unsaved buffer :contentReference[oaicite:5]{index=5}
    const selection = editor.getSelection();

    // Decide offsets based on mode:
    // - replace: the selection range
    // - insert: cursor/end-of-selection position
    const fromPos = editor.getCursor("from");
    const toPos = editor.getCursor("to");

    const selStartOffset = editor.posToOffset(fromPos);
    const selEndOffset = editor.posToOffset(toPos);

    const insertOffset = editor.posToOffset(toPos);

    const ctxPoint = mode === "replace" ? selStartOffset : insertOffset;
    const ctxPointEnd = mode === "replace" ? selEndOffset : insertOffset;

    // Fixed-size window per side; full document is already passed separately.
    const beforeStart = Math.max(0, ctxPoint - CONTEXT_WINDOW_CHARS);
    const afterEnd = Math.min(doc.length, ctxPointEnd + CONTEXT_WINDOW_CHARS);
    const contextBefore = doc.slice(beforeStart, ctxPoint);
    const contextAfter = doc.slice(ctxPointEnd, afterEnd);

    const percentStart = doc.length ? ctxPoint / doc.length : 0;
    const percentEnd = doc.length ? ctxPointEnd / doc.length : 0;

    if (mode === "replace" && !selection) {
      throw new Error("Replace mode requires a selection.");
    }

    this.setBusy(true, "Running AI edit…");

    let content: string;
    try {
      content = await generateAiText({
        apiKey: apiKey || undefined,
        apiBaseUrl,
        model,
        mode,
        documentMarkdown: doc,
        selectedText: selection,
        contextBefore,
        contextAfter,
        selectionStartOffset: ctxPoint,
        selectionEndOffset: ctxPointEnd,
        selectionPercentStart: percentStart,
        selectionPercentEnd: percentEnd,
        userPrompt
      });
    } finally {
      this.setBusy(false);
    }

    // Some local models may return literal "\n" sequences; normalize to real newlines if none exist.
    if (!content.includes("\n") && content.includes("\\n")) {
      content = content.replace(/\\n/g, "\n");
    }

    if (mode === "replace") {
      editor.replaceSelection(content); // :contentReference[oaicite:6]{index=6}
      this.highlightRange(editor, selStartOffset, selStartOffset + content.length);
      new Notice("Selection replaced. Undo with Cmd/Ctrl+Z.");
      return;
    }

    // Insert path: normalize output to avoid double markers or broken blocks.
    const beforeChar = insertOffset > 0 ? doc[insertOffset - 1] : "";
    const afterChar = insertOffset < doc.length ? doc[insertOffset] : "";
    const docLines = doc.split("\n");
    const currentLine = docLines[toPos.line] ?? "";

    let finalContent = trimOuterBlankLines(content, beforeChar === "\n", afterChar === "\n");

    const nextLineText = docLines[toPos.line + 1] ?? "";
    const nextIsFence = /^\s*(```|~~~)/.test(nextLineText);
    const fenceBounds = findFenceBounds(docLines, toPos.line);
    const insideFence =
      fenceBounds !== null
        ? toPos.line >= fenceBounds.start && toPos.line <= fenceBounds.end
        : isInsideCodeFence(doc, toPos.line) || (currentLine.trim().length === 0 && nextIsFence);
    if (insideFence) {
      finalContent = stripOuterCodeFence(finalContent);
      const insertText = finalContent.endsWith("\n") ? finalContent : `${finalContent}\n`;
      if (currentLine.trim().length === 0 && toPos.line + 1 < docLines.length) {
        // Replace the blank line (including its newline) to avoid double spacing before the closing fence.
        const from = { line: toPos.line, ch: 0 };
        const to = { line: toPos.line + 1, ch: 0 };
        editor.replaceRange(insertText, from, to);
        const start = editor.posToOffset(from);
        this.highlightRange(editor, start, start + insertText.length);
      } else {
        const targetLine = fenceBounds ? fenceBounds.end : toPos.line;
        const from = { line: targetLine, ch: 0 };
        editor.replaceRange(insertText, from);
        const start = editor.posToOffset(from);
        this.highlightRange(editor, start, start + insertText.length);
      }
      new Notice("Text inserted. Undo with Cmd/Ctrl+Z.");
      return;
    }

    const currentLineList = getListLineInfo(currentLine);
    const atLineEnd = toPos.ch === currentLine.length;
    if (currentLineList && !currentLineList.isStub && atLineEnd && !finalContent.startsWith("\n")) {
      finalContent = `\n${finalContent}`;
    }

    finalContent = normalizeParagraphSpacing(finalContent, docLines, toPos.line);

    const listInfo = getListLineInfo(currentLine);
    if (listInfo?.isStub) {
      const cleaned = normalizeListText(finalContent, listInfo.indent, listInfo.marker);
      const replaceFrom = { line: toPos.line, ch: 0 };
      const replaceTo = { line: toPos.line, ch: currentLine.length };
      editor.replaceRange(cleaned, replaceFrom, replaceTo);
      const start = editor.posToOffset(replaceFrom);
      this.highlightRange(editor, start, start + cleaned.length);
      new Notice("Text inserted. Undo with Cmd/Ctrl+Z.");
      return;
    }

    const blockquotePrefix = getBlockquotePrefix(currentLine);
    if (blockquotePrefix) {
      finalContent = applyBlockquotePrefix(finalContent, blockquotePrefix);
      const onlyPrefix = currentLine.replace(/^\s*>+\s?/, "").trim().length === 0;
      if (onlyPrefix) {
        const replaceFrom = { line: toPos.line, ch: 0 };
        const replaceTo = { line: toPos.line, ch: currentLine.length };
        editor.replaceRange(finalContent, replaceFrom, replaceTo);
        const start = editor.posToOffset(replaceFrom);
        this.highlightRange(editor, start, start + finalContent.length);
        new Notice("Text inserted. Undo with Cmd/Ctrl+Z.");
        return;
      }
    }

    // Insert at cursor or end-of-selection using replaceRange(pos). :contentReference[oaicite:7]{index=7}
    editor.replaceRange(finalContent, toPos);
    const start = insertOffset;
    this.highlightRange(editor, start, start + finalContent.length);
    new Notice("Text inserted. Undo with Cmd/Ctrl+Z.");
  }
}
