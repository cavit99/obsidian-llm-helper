import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianAiLlmHelperPlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

export class ObsidianAiLlmHelperSettingTab extends PluginSettingTab {
  plugin: ObsidianAiLlmHelperPlugin;

  constructor(app: App, plugin: ObsidianAiLlmHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian AI LLM Helper settings" });

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Used for servers that require Bearer auth (OpenAI, etc.). Leave empty for local servers that do not need auth.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.openAiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("Responses API base. OpenAI default or local LM Studio: http://localhost:1234/v1")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl)
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("The model name sent to the Responses API.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
            await this.plugin.saveSettings();
          });
      });
  }
}
