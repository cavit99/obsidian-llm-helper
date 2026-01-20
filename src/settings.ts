import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
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

    new Setting(containerEl).setName("AI helper").setHeading();

    if (!this.plugin.settings.openAiSecretId) {
      this.plugin.settings.openAiSecretId = "llm-helper-api-key";
      void this.plugin.saveSettings();
    }

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Select or create a secret (per-device). Suggested ID: llm-helper-api-key.")
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.openAiSecretId)
          .onChange(async (value) => {
            this.plugin.settings.openAiSecretId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("Responses API base, for example https://api.openai.com/v1 or http://localhost:1234/v1 for LM Studio.")
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
      .setName("Model name")
      .setDesc("The model name sent to the responses API.")
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
