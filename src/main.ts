import { Editor, Notice, Plugin } from "obsidian";
import type { ApplyMode, ObsidianAiLlmHelperSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { ObsidianAiLlmHelperSettingTab } from "./settings";
import { PromptModal } from "./promptModal";
import { generateAiText } from "./openai";

const CONTEXT_WINDOW_CHARS = 500; // fixed per side, plus full document is always sent.

export default class ObsidianAiLlmHelperPlugin extends Plugin {
  settings: ObsidianAiLlmHelperSettings = DEFAULT_SETTINGS;
  private statusBarEl?: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new ObsidianAiLlmHelperSettingTab(this.app, this));

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("obsidian-llm-helper-statusbar");
    this.statusBarEl.style.display = "none";

    // Single command: ask AI; mode is inferred from selection (replace if selected, otherwise insert).
    this.addCommand({
      id: "obsidian-llm-helper-ask",
      name: "Obsidian AI LLM Helper: Ask AI…",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }], // Cmd/Ctrl+Shift+A
      editorCallback: (editor: Editor) => {
        new PromptModal(this.app, this, editor).open();
      }
    });

    // Editor context menu integration: subscribe to editor-menu workspace event. :contentReference[oaicite:4]{index=4}
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor: Editor) => {
        menu.addItem((item) => {
          item.setTitle("Obsidian AI LLM Helper: Ask AI…");
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

  private setBusy(on: boolean, message = "Obsidian AI LLM Helper: running…"): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.style.display = on ? "block" : "none";
    this.statusBarEl.textContent = message;
  }

  async runAiEdit(editor: Editor, mode: ApplyMode, userPrompt: string): Promise<void> {
    const apiKey = this.settings.openAiApiKey?.trim();
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

    this.setBusy(true, "Obsidian AI LLM Helper: running…");

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

    if (mode === "replace") {
      editor.replaceSelection(content); // :contentReference[oaicite:6]{index=6}
      new Notice("Obsidian AI LLM Helper: selection replaced. Undo with Cmd/Ctrl+Z.");
      return;
    }

    // Insert at cursor or end-of-selection using replaceRange(pos). :contentReference[oaicite:7]{index=7}
    editor.replaceRange(content, toPos);
    new Notice("Obsidian AI LLM Helper: text inserted. Undo with Cmd/Ctrl+Z.");
  }
}
