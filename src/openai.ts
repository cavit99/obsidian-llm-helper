import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { requestUrl } from "obsidian";
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

function normalizeError(err: unknown): Error {
  const source = (err ?? {}) as Record<string, unknown>;
  const response = (source.response as Record<string, unknown>) ?? {};
  const responseData = (response.data as Record<string, unknown>) ?? {};
  const errorObj = (source.error as Record<string, unknown>) ?? {};

  const statusCandidates = [
    source.status,
    source.httpStatus,
    source.statusCode,
    response.status,
    response.statusCode
  ];
  const status = statusCandidates.find((v): v is number => typeof v === "number");

  const codeCandidates = [source.code, errorObj.code, responseData.error ? (responseData.error as Record<string, unknown>).code : undefined];
  const code = codeCandidates.find((v): v is string => typeof v === "string");

  const detailCandidates = [
    errorObj.message,
    responseData.error ? (responseData.error as Record<string, unknown>).message : undefined,
    response.error ? (response.error as Record<string, unknown>).message : undefined,
    source.message
  ];
  const detail = detailCandidates.find((v): v is string => typeof v === "string");
  const name = typeof source.name === "string" ? source.name : typeof (source.constructor as { name?: string })?.name === "string" ? (source.constructor as { name?: string }).name : undefined;
  const msg = toErrorMessage(err);

  const authPatterns = /invalid api key|incorrect api key|authentication|unauthorized|auth failed|invalid authentication/i;

  if (
    status === 401 ||
    code === "invalid_api_key" ||
    name === "AuthenticationError" ||
    authPatterns.test(msg) ||
    (detail ? authPatterns.test(detail) : false)
  ) {
    return new Error(`Authentication failed. Check your API key and project/organization. (${detail ?? msg})`);
  }
  if (/connection error/i.test(msg)) {
    return new Error(`Request failed. Check your API key and network/base URL. (${detail ?? msg})`);
  }
  return err instanceof Error ? err : new Error(msg);
}

function findRefusal(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const message = item as { content?: unknown };
    if (!Array.isArray(message.content)) continue;
    for (const c of message.content) {
      if (c && typeof c === "object" && (c as { type?: string }).type === "refusal") {
        const text = (c as { refusal?: string }).refusal;
        if (typeof text === "string" && text.trim()) return text;
      }
    }
  }
  return null;
}

function stripCodeFences(text: string): string {
  const fenced = text.trim();
  if (fenced.startsWith("```") && fenced.endsWith("```")) {
    return fenced.replace(/^```[a-zA-Z0-9]*\s*/, "").replace(/```$/, "").trim();
  }
  return text;
}

function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost") return true;
    if (parsed.hostname === "0.0.0.0") return true;
    if (parsed.hostname === "127.0.0.1") return true;
    if (parsed.hostname.startsWith("192.168.")) return true;
    if (parsed.hostname.startsWith("10.")) return true;
    // RFC1918 172.16.0.0 – 172.31.255.255
    if (parsed.hostname.startsWith("172.")) {
      const parts = parsed.hostname.split(".");
      const second = Number(parts[1]);
      if (!Number.isNaN(second) && second >= 16 && second <= 31) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function createClient(apiKey: string | undefined, baseURL: string): OpenAI {
  const key = apiKey?.trim();
  return new OpenAI({
    apiKey: key,
    baseURL,
    dangerouslyAllowBrowser: true,
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const headersObj = new Headers(init?.headers ?? {});
      const headers: Record<string, string> = {};
      headersObj.forEach((v, k) => {
        headers[k] = v;
      });
      const body = (init?.body as string | ArrayBuffer | ArrayBufferView | FormData | null | undefined) ?? undefined;
      const res = await requestUrl({
        url,
        method: init?.method ?? "GET",
        headers,
        body
      });
      const responseBody = res.arrayBuffer ?? res.text ?? "";
      return new Response(responseBody, {
        status: res.status,
        statusText: "",
        headers: res.headers as Record<string, string>
      });
    }
  });
}

async function callResponsesApi(apiKey: string | undefined, apiBaseUrl: string, model: string, payload: AiContextPayload): Promise<string> {
  const client = createClient(apiKey, apiBaseUrl);
  try {
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: buildSystemInstructions() },
        { role: "user", content: buildUserMessage(payload) }
      ],
      text: {
        format: zodTextFormat(ContentSchema, "obsidian_ai_llm_helper_edit")
      },
      prompt_cache_key: "obsidian_llm_helper_v1",
      store: false
    });

    const parsedResponse = response as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: unknown;
      output_parsed?: { content?: string };
    };

    if (parsedResponse.status === "incomplete") {
      const reason = parsedResponse.incomplete_details?.reason;
      throw new Error(reason ? `Model response incomplete: ${reason}` : "Model response incomplete.");
    }
    const refusal = findRefusal(parsedResponse.output);
    if (refusal) throw new Error(`Model refused the request: ${refusal}`);
    const parsed = parsedResponse.output_parsed;
    if (!parsed || typeof parsed.content !== "string") {
      throw new Error("Model output missing content.");
    }
    return parsed.content;
  } catch (err) {
    throw normalizeError(err);
  }
}

async function callResponsesApiJsonModeFallback(apiKey: string | undefined, apiBaseUrl: string, model: string, payload: AiContextPayload): Promise<string> {
  const client = createClient(apiKey, apiBaseUrl);
  try {
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
      prompt_cache_key: "obsidian_llm_helper_v1",
      store: false
    });

    const parsedResponse = response as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: unknown;
      output_text?: string;
    };

    if (parsedResponse.status === "incomplete") {
      const reason = parsedResponse.incomplete_details?.reason;
      throw new Error(reason ? `Model response incomplete: ${reason}` : "Model response incomplete.");
    }

    const refusal = findRefusal(parsedResponse.output);
    if (refusal) throw new Error(`Model refused the request: ${refusal}`);

    const outputText = parsedResponse.output_text;
    if (!outputText || !outputText.trim()) throw new Error("Empty model output.");

    const parsed = ContentSchema.parse(JSON.parse(outputText));
    return parsed.content;
  } catch (err) {
    throw normalizeError(err);
  }
}

async function callLocalChatCompletions(apiBaseUrl: string, model: string, payload: AiContextPayload): Promise<string> {
  const res = await requestUrl({
    url: apiBaseUrl,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildSystemInstructions() },
        { role: "user", content: buildUserMessage(payload) }
      ],
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "obsidian_ai_llm_helper_edit",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { content: { type: "string" } },
            required: ["content"]
          }
        }
      },
      stream: false
    })
  });

  if (res.status >= 400) {
    throw new Error(res.text || `HTTP ${res.status}`);
  }

  const data = (res.json as { choices?: Array<{ message?: { content?: unknown } }> } | undefined) ?? JSON.parse(res.text ?? "{}");
  const choice = data?.choices?.[0]?.message?.content;
  if (typeof choice === "string" && choice.trim()) {
    const cleaned = stripCodeFences(choice).trim();
    try {
      const parsed = ContentSchema.parse(JSON.parse(cleaned));
      return parsed.content;
    } catch {
      return cleaned;
    }
  }
  throw new Error("Empty model output.");
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
    if (isLocalUrl(apiBaseUrl)) {
      return await callLocalChatCompletions(apiBaseUrl, args.model, payload);
    }
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
