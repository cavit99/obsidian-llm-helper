import { App, Modal, Notice, Setting } from "obsidian";
import type { Editor } from "obsidian";
import type ObsidianAiLlmHelperPlugin from "./main";
import type { ApplyMode } from "./types";

export class PromptModal extends Modal {
  private plugin: ObsidianAiLlmHelperPlugin;
  private editor: Editor;

  private prompt: string = "";
  private isRunning = false;

  private runBtn?: HTMLButtonElement;
  private statusEl?: HTMLDivElement;
  private statusTextEl?: HTMLSpanElement;

  constructor(app: App, plugin: ObsidianAiLlmHelperPlugin, editor: Editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const selection = this.editor.getSelection();
    const hasSelection = selection.length > 0;

    if (!hasSelection) {
      contentEl.createEl("p", { text: "No selection detected. We will insert at the cursor." });
    }

    new Setting(contentEl)
      .setName("What do you want the AI to do?")
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text.setPlaceholder("Press Enter to ask AI…");
        text.onChange((value) => (this.prompt = value));

        text.inputEl.addEventListener("keydown", async (e: KeyboardEvent) => {
          if ((e as any).isComposing) return;

          // Enter submits; Shift+Enter inserts newline.
          if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.prompt = text.getValue();
            await this.run();
            return;
          }
          if (e.key === "Enter" && e.shiftKey) {
            return; // allow newline
          }

          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            this.prompt = text.getValue();
            await this.run();
          }
        });
      });

    // Status row (spinner + text)
    this.statusEl = contentEl.createDiv({ cls: "obsidian-llm-helper-status" });
    this.statusEl.createSpan({ cls: "obsidian-llm-helper-spinner" });
    this.statusTextEl = this.statusEl.createSpan({ text: "" });

    const btnRow = contentEl.createDiv({ cls: "obsidian-llm-helper-btn-row" });
    this.runBtn = btnRow.createEl("button", { text: "Ask AI" });
    this.runBtn.addEventListener("click", async () => await this.run());
  }

  private setLoading(on: boolean, message: string): void {
    this.isRunning = on;

    if (this.runBtn) {
      this.runBtn.disabled = on;
      this.runBtn.textContent = on ? "Asking…" : "Ask AI";
    }

    if (this.statusEl) {
      this.statusEl.style.display = on ? "flex" : "none";
    }
    if (this.statusTextEl) {
      this.statusTextEl.textContent = message;
    }
  }

  private async run(): Promise<void> {
    if (this.isRunning) return;
    const trimmed = (this.prompt ?? "").trim();
    if (!trimmed) {
      new Notice("Enter a prompt first.");
      return;
    }

    const apiKey = this.plugin.settings.openAiApiKey;
    const apiBaseUrl = this.plugin.settings.apiBaseUrl ?? "";
    const isOpenAiBase = apiBaseUrl.toLowerCase().includes("openai.com");
    if (isOpenAiBase && !apiKey) {
      new Notice("Add an API key for OpenAI, or change API base URL (e.g., http://localhost:1234/v1).");
      return;
    }

    const selection = this.editor.getSelection();
    const mode: ApplyMode = selection ? "replace" : "insert";

    this.setLoading(true, "Calling model…");

    try {
      await this.plugin.runAiEdit(this.editor, mode, trimmed);
      this.setLoading(false, "");
      this.close();
    } catch (err) {
      console.error("[obsidian-llm-helper] run failed", err);
      this.setLoading(false, "");
      new Notice(`Obsidian AI LLM Helper error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
