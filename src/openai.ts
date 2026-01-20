import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { ApplyMode, AiContextPayload } from "./types";

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

const ContentSchema = z.object({ content: z.string() });

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

function createClient(apiKey: string | undefined, baseURL: string): OpenAI {
  const key = apiKey?.trim();
  return new OpenAI({ apiKey: key, baseURL, dangerouslyAllowBrowser: true });
}

async function callResponsesApi(apiKey: string | undefined, apiBaseUrl: string, model: string, payload: AiContextPayload): Promise<string> {
  const client = createClient(apiKey, apiBaseUrl);
  const response = await client.responses.parse({
    model,
    input: [
      { role: "system", content: buildSystemInstructions() },
      { role: "user", content: buildUserMessage(payload) }
    ],
    text: {
      format: zodTextFormat(ContentSchema, "obsidian_ai_llm_helper_edit")
    },
    store: false
  });

  if (response.status === "incomplete") {
    const reason = (response as any).incomplete_details?.reason;
    throw new Error(reason ? `Model response incomplete: ${reason}` : "Model response incomplete.");
  }
  const parsed = (response as any).output_parsed as z.infer<typeof ContentSchema> | undefined;
  if (!parsed || typeof parsed.content !== "string") {
    throw new Error("Model output missing content.");
  }
  return parsed.content;
}

async function callResponsesApiJsonModeFallback(apiKey: string | undefined, apiBaseUrl: string, model: string, payload: AiContextPayload): Promise<string> {
  const client = createClient(apiKey, apiBaseUrl);
  const response = await client.responses.create({
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
  });

  if (response.status === "incomplete") {
    const reason = (response as any).incomplete_details?.reason;
    throw new Error(reason ? `Model response incomplete: ${reason}` : "Model response incomplete.");
  }

  const outputText = (response as any).output_text as string | undefined;
  if (!outputText || !outputText.trim()) throw new Error("Empty model output.");

  const parsed = ContentSchema.parse(JSON.parse(outputText));
  return parsed.content;
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
