import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { ApplyMode, AiContextPayload } from "./types";

function buildResponsesUrl(baseUrl: string): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Missing Responses API base URL.");
  return `${trimmed}/responses`;
}

function buildSystemInstructions(): string {
  return [
    "You are a writing assistant inside a Markdown file in writing app Obsidian.",
    "You will receive a markdown document, an optional selected excerpt, surrounding context, and a user prompt.",
    "Return ONLY JSON matching the provided schema.",
    "The `content` you return must be markdown (no HTML).",
    "If mode=replace: rewrite ONLY the selected text. Do not return the whole document.",
    "If mode=insert: write new text to insert at the cursor/end-of-selection. Do not repeat surrounding context."
  ].join("\n");
}

function buildUserMessage(payload: AiContextPayload): string {
  // Keep it plain and deterministic. The schema handles structure on the output side.
  return [
    `mode: ${payload.mode}`,
    "",
    "user_prompt:",
    payload.userPrompt,
    "",
    "document_markdown:",
    payload.documentMarkdown,
    "",
    "selected_text:",
    payload.selectedText || "(none)",
    "",
    "context_before (closest text before selection/cursor):",
    payload.contextBefore || "(none)",
    "",
    "context_after (closest text after selection/cursor):",
    payload.contextAfter || "(none)",
    "",
    `selection_start_offset: ${payload.selectionStartOffset}`,
    `selection_end_offset: ${payload.selectionEndOffset}`,
    `selection_percent_start: ${payload.selectionPercentStart}`,
    `selection_percent_end: ${payload.selectionPercentEnd}`
  ].join("\n");
}

function extractOutputText(resp: unknown): string {
  if (typeof resp === "object" && resp !== null) {
    const responseObject = resp as { output_text?: unknown; output?: unknown };
    if (typeof responseObject.output_text === "string" && responseObject.output_text.trim()) {
      return responseObject.output_text;
    }
    if (Array.isArray(responseObject.output)) {
      const chunks: string[] = [];
      for (const item of responseObject.output) {
        if (!item || typeof item !== "object") continue;
        const message = item as { type?: unknown; content?: unknown };
        if (message.type !== "message" || !Array.isArray(message.content)) continue;
        for (const content of message.content) {
          if (!content || typeof content !== "object") continue;
          const chunk = content as { type?: unknown; text?: unknown };
          if (chunk.type === "output_text" && typeof chunk.text === "string") {
            chunks.push(chunk.text);
          }
        }
      }
      return chunks.join("");
    }
  }

  // SDK-only convenience might not exist in raw REST responses, but harmless to check.
  return "";
}

function safeJsonFromText(text: string): unknown {
  const trimmed = (text ?? "").trim();
  if (!trimmed) throw new Error("Empty model output.");

  try {
    return JSON.parse(trimmed);
  } catch {
    // Last-ditch: try to extract a single JSON object substring.
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const slice = trimmed.slice(first, last + 1);
      return JSON.parse(slice);
    }
    throw new Error("Model output was not valid JSON. Try a different model.");
  }
}

function getResponseErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  return `HTTP ${status}`;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function callResponsesApi(apiKey: string | undefined, apiBaseUrl: string, model: string, payload: AiContextPayload): Promise<string> {
  const reqBody = {
    model,
    // You can also send a single string input, but we want a clear system + user split.
    input: [
      { role: "system", content: buildSystemInstructions() },
      { role: "user", content: buildUserMessage(payload) }
    ],
    // Structured Outputs for Responses API: text.format with json_schema.
    text: {
      format: {
        type: "json_schema",
        name: "obsidian_ai_llm_helper_edit",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: {
              type: "string",
              description: "Markdown text to apply (replace selection or insert)."
            }
          },
          required: ["content"]
        }
      }
    },
    // Reduce accidental retention by default.
    store: false
  };

  const res: RequestUrlResponse = await requestUrl({
    url: buildResponsesUrl(apiBaseUrl),
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(reqBody)
  });

  const data: unknown = res.json ?? JSON.parse(res.text ?? "{}");

  if (res.status >= 400) {
    throw new Error(getResponseErrorMessage(data, res.status));
  }

  const outputText = extractOutputText(data);
  const parsed = safeJsonFromText(outputText);

  const content = (parsed as { content?: unknown }).content;
  if (typeof content !== "string") throw new Error("Schema mismatch: expected { content: string }.");
  return content;
}

async function callResponsesApiJsonModeFallback(apiKey: string | undefined, apiBaseUrl: string, model: string, payload: AiContextPayload): Promise<string> {
  // Fallback if json_schema is not supported on a given model.
  const reqBody = {
    model,
    input: [
      {
        role: "system",
        content: buildSystemInstructions() + "\nIf you cannot follow schema, still output a single JSON object with key `content`."
      },
      { role: "user", content: buildUserMessage(payload) }
    ],
    text: { format: { type: "json_object" } },
    store: false
  };

  const res: RequestUrlResponse = await requestUrl({
    url: buildResponsesUrl(apiBaseUrl),
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(reqBody)
  });

  const data: unknown = res.json ?? JSON.parse(res.text ?? "{}");

  if (res.status >= 400) {
    throw new Error(getResponseErrorMessage(data, res.status));
  }

  const outputText = extractOutputText(data);
  const parsed = safeJsonFromText(outputText);

  const content = (parsed as { content?: unknown }).content;
  if (typeof content !== "string") throw new Error("JSON mode output did not contain { content: string }.");
  return content;
}

export async function generateAiText(args: {
  apiKey?: string;
  apiBaseUrl: string;
  model: string;
  mode: ApplyMode;
  documentMarkdown: string;
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
  selectionStartOffset: number;
  selectionEndOffset: number;
  selectionPercentStart: number;
  selectionPercentEnd: number;
  userPrompt: string;
}): Promise<string> {
  const payload: AiContextPayload = {
    mode: args.mode,
    documentMarkdown: args.documentMarkdown,
    selectedText: args.selectedText,
    contextBefore: args.contextBefore,
    contextAfter: args.contextAfter,
    selectionStartOffset: args.selectionStartOffset,
    selectionEndOffset: args.selectionEndOffset,
    selectionPercentStart: args.selectionPercentStart,
    selectionPercentEnd: args.selectionPercentEnd,
    userPrompt: args.userPrompt
  };

  const apiBaseUrl = (args.apiBaseUrl ?? "").trim() || "https://api.openai.com/v1";

  try {
    return await callResponsesApi(args.apiKey, apiBaseUrl, args.model, payload);
  } catch (e: unknown) {
    const msg = toErrorMessage(e);
    // Common failure: model does not support json_schema structured outputs.
    if (msg.toLowerCase().includes("json_schema") || msg.toLowerCase().includes("structured")) {
      return await callResponsesApiJsonModeFallback(args.apiKey, apiBaseUrl, args.model, payload);
    }
    throw e;
  }
}
