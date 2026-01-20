import { App, PluginSettingTab, SecretComponent, Setting, type TextComponent, type DropdownComponent } from "obsidian";
import type ObsidianAiLlmHelperPlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

export class ObsidianAiLlmHelperSettingTab extends PluginSettingTab {
  plugin: ObsidianAiLlmHelperPlugin;

  private readonly LOCAL_LM_STUDIO_DEFAULT = "http://localhost:1234/v1/chat/completions";
  private readonly OPENROUTER_BASE = "https://openrouter.ai/api/v1";

  constructor(app: App, plugin: ObsidianAiLlmHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    let customInput: TextComponent;
    let endpointDropdown: DropdownComponent;

    new Setting(containerEl).setName("AI helper").setHeading();

    if (!this.plugin.settings.openAiSecretId) {
      this.plugin.settings.openAiSecretId = "llm-helper-api-key";
      void this.plugin.saveSettings();
    }

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Select or create a secret. ID can be anything. Needed for OpenAI models.")
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
      .setDesc("Choose OpenAI default or enter a custom endpoint.")
      .addDropdown((dropdown) => {
        endpointDropdown = dropdown as DropdownComponent;
        dropdown.addOption("openai", "OpenAI");
        dropdown.addOption("openrouter", "OpenRouter");
        dropdown.addOption("custom", "Custom…");
        const isCustom = this.plugin.settings.apiBaseUrl !== DEFAULT_SETTINGS.apiBaseUrl;
        dropdown.setValue(isCustom ? "custom" : "openai");
        dropdown.onChange(async (value) => {
          if (value === "openai") {
            this.plugin.settings.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
            await this.plugin.saveSettings();
            customInput.setValue(DEFAULT_SETTINGS.apiBaseUrl);
          } else if (value === "openrouter") {
            this.plugin.settings.apiBaseUrl = this.OPENROUTER_BASE;
            await this.plugin.saveSettings();
            customInput.setValue(this.OPENROUTER_BASE);
          } else {
            // Prefill a sensible local default when switching to Custom from the default.
            const current = customInput.getValue().trim();
            const nextValue =
              current === DEFAULT_SETTINGS.apiBaseUrl || current === "" ? this.LOCAL_LM_STUDIO_DEFAULT : current;
            customInput.setValue(nextValue);
            this.plugin.settings.apiBaseUrl = nextValue;
            await this.plugin.saveSettings();
          }
        });
      })
      .addText((text) => {
        customInput = text as TextComponent;
        text
          .setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl)
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
            await this.plugin.saveSettings();
            if (!endpointDropdown) return;
            if (this.plugin.settings.apiBaseUrl !== DEFAULT_SETTINGS.apiBaseUrl) endpointDropdown.setValue("custom");
            else endpointDropdown.setValue("openai");
          });
      });

    new Setting(containerEl)
      .setName("Model name")
      .setDesc("The model name sent to the endpoint. e.g. gpt-5.2 for OpenAI, or mistral-nemo as a locally hosted model")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Hotkey")
      .setDesc("Optional: set your shortcut for ‘Ask AI…’ in Settings → Hotkeys (search ‘Ask AI…’).")
      .addButton((btn) => {
        btn.setButtonText("Open hotkeys").onClick(() => {
          // Falls back silently if the settings API shape changes.
          // @ts-expect-error openTabById is available on the settings view in Obsidian 1.11.x
          this.app.setting?.openTabById?.("hotkeys");
          // Attempt to prefill the Hotkeys search with our command name.
          window.setTimeout(() => {
            const activeTab = (this.app as any).setting?.activeTab;
            const search = activeTab?.searchComponent;
            try {
              if (search?.setValue) search.setValue("Ask AI…");
              if (search?.inputEl) {
                search.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
              }
            } catch (e) {
              // best-effort only
              console.debug("[llm-helper] hotkey search prefill failed", e);
            }
          }, 50);
        });
      });

    // Support / Buy Me a Coffee
    const support = containerEl.createDiv({ cls: "obsidian-llm-helper-support" });
    const link = support.createEl("a", {
      href: "https://buymeacoffee.com/cavit99",
      attr: { target: "_blank", rel: "noopener" }
    });
    const img = link.createEl("img", {
      attr: {
        src: "https://www.owlstown.com/assets/icons/bmc-yellow-button-941f96a1.png",
        alt: "Buy Me a Coffee"
      }
    });
    img.addClass("obsidian-llm-helper-support-img");
  }
}
