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
      .setDesc("Select or create a secret. The ID can be anything. Needed for OpenAI models.")
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.openAiSecretId)
          .onChange((value) => {
            this.plugin.settings.openAiSecretId = value.trim();
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("Choose the OpenAI default or enter a custom endpoint.")
      .addDropdown((dropdown) => {
        endpointDropdown = dropdown;
        dropdown.addOption("openai", "OpenAI");
        dropdown.addOption("openrouter", "OpenRouter");
        dropdown.addOption("custom", "Custom…");
        const isCustom = this.plugin.settings.apiBaseUrl !== DEFAULT_SETTINGS.apiBaseUrl;
        dropdown.setValue(isCustom ? "custom" : "openai");
        dropdown.onChange(async (value) => {
          if (value === "openai") {
            this.plugin.settings.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
            void this.plugin.saveSettings();
            customInput.setValue(DEFAULT_SETTINGS.apiBaseUrl);
          } else if (value === "openrouter") {
            this.plugin.settings.apiBaseUrl = this.OPENROUTER_BASE;
            void this.plugin.saveSettings();
            customInput.setValue(this.OPENROUTER_BASE);
          } else {
            // Prefill a sensible local default when switching to Custom from the default.
            const current = customInput.getValue().trim();
            const nextValue =
              current === DEFAULT_SETTINGS.apiBaseUrl || current === "" ? this.LOCAL_LM_STUDIO_DEFAULT : current;
            customInput.setValue(nextValue);
            this.plugin.settings.apiBaseUrl = nextValue;
            void this.plugin.saveSettings();
          }
        });
      })
      .addText((text) => {
        customInput = text;
        text
          .setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl)
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange((value) => {
            this.plugin.settings.apiBaseUrl = value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
            void this.plugin.saveSettings();
            if (!endpointDropdown) return;
            if (this.plugin.settings.apiBaseUrl !== DEFAULT_SETTINGS.apiBaseUrl) endpointDropdown.setValue("custom");
            else endpointDropdown.setValue("openai");
          });
      });

    new Setting(containerEl)
      .setName("Model name")
      .setDesc("Model name sent to the endpoint, for example gpt-5.2 (OpenAI) or mistral-nemo (local).")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.model)
          .setValue(this.plugin.settings.model)
          .onChange((value) => {
            this.plugin.settings.model = value.trim() || DEFAULT_SETTINGS.model;
            void this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Keyboard shortcut")
      .setDesc("Optional: set your shortcut for “Ask AI…” in Settings → Hotkeys (search “Ask AI…”).")
      .addButton((btn) => {
        btn.setButtonText("Open hotkeys").onClick(() => {
          const settingsView = this.app as App & {
            setting?: {
              openTabById?: (id: string) => void;
              activeTab?: { searchComponent?: { setValue?: (v: string) => void; inputEl?: HTMLElement } };
            };
          };
          settingsView.setting?.openTabById?.("hotkeys");
          window.setTimeout(() => {
            const activeTab = settingsView.setting?.activeTab;
            const search = activeTab?.searchComponent;
            try {
              search?.setValue?.("Ask AI…");
              if (search?.inputEl) {
                search.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
              }
            } catch (e) {
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
