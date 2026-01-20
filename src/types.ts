export type ApplyMode = "replace" | "insert";

export interface ObsidianAiLlmHelperSettings {
  openAiApiKey: string;
  model: string;
  apiBaseUrl: string;
}

export const DEFAULT_SETTINGS: ObsidianAiLlmHelperSettings = {
  openAiApiKey: "",
  model: "gpt-5.2",
  apiBaseUrl: "https://api.openai.com/v1"
};

export interface AiContextPayload {
  documentMarkdown: string;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  selectionStartOffset: number;
  selectionEndOffset: number;
  selectionPercentStart: number; // 0..1
  selectionPercentEnd: number;   // 0..1
  userPrompt: string;
  mode: ApplyMode;
}
