import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateAiText } from "../src/openai";

const parseMock = vi.fn();
const createMock = vi.fn();
const requestUrlMock = vi.fn();

vi.mock("obsidian", () => ({
  requestUrl: (...args: unknown[]) => requestUrlMock(...args)
}));

vi.mock("openai", () => {
  return {
    default: class OpenAI {
      responses = {
        parse: parseMock,
        create: createMock
      };
      constructor(_: any) {}
    }
  };
});

describe("generateAiText error handling", () => {
  const baseArgs = {
    apiKey: "test",
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-5.2",
    mode: "insert" as const,
    documentMarkdown: "doc",
    selectedText: "",
    contextBefore: "",
    contextAfter: "",
    selectionStartOffset: 0,
    selectionEndOffset: 0,
    selectionPercentStart: 0,
    selectionPercentEnd: 0,
    userPrompt: "hi"
  };

  beforeEach(() => {
    parseMock.mockReset();
    createMock.mockReset();
    requestUrlMock.mockReset();
  });

  it("throws on refusal responses", async () => {
    parseMock.mockResolvedValue({
      status: "completed",
      output: [
        {
          content: [{ type: "refusal", refusal: "no" }]
        }
      ]
    });

    await expect(generateAiText(baseArgs)).rejects.toThrow(/refused/i);
  });

  it("throws on incomplete responses", async () => {
    parseMock.mockResolvedValue({
      status: "incomplete",
      incomplete_details: { reason: "max_tokens" }
    });

    await expect(generateAiText(baseArgs)).rejects.toThrow(/incomplete/i);
  });

  it("bubbles SDK errors (e.g., auth failures)", async () => {
    parseMock.mockRejectedValue(new Error("401 invalid authentication"));

    await expect(generateAiText(baseArgs)).rejects.toThrow(/401/);
  });

  it("falls back to JSON mode when schema is unsupported and then respects refusals", async () => {
    parseMock.mockRejectedValue(new Error("json_schema not supported"));
    createMock.mockResolvedValue({
      status: "completed",
      output: [
        {
          content: [{ type: "refusal", refusal: "not allowed" }]
        }
      ],
      output_text: ""
    });

    await expect(generateAiText(baseArgs)).rejects.toThrow(/refused/i);
  });

  it("returns parsed content on successful responses.parse", async () => {
    parseMock.mockResolvedValue({
      status: "completed",
      output: [],
      output_parsed: { content: "ok" }
    });

    await expect(generateAiText(baseArgs)).resolves.toBe("ok");
  });

  it("routes local chat/completions untouched and parses fenced JSON", async () => {
    const args = { ...baseArgs, apiBaseUrl: "http://localhost:1234/v1/chat/completions" };
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        choices: [{ message: { content: "```json\n{\"content\":\"- Item\"}\n```" } }]
      }
    });

    const result = await generateAiText(args);
    expect(result).toBe("- Item");
    expect(requestUrlMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(requestUrlMock.mock.calls[0][0].body);
    expect(body).toHaveProperty("messages");
    expect(body).toHaveProperty("response_format");
    expect(body).toHaveProperty("temperature", 0.2);
  });

  it("returns raw text when JSON parsing fails but content is present", async () => {
    const args = { ...baseArgs, apiBaseUrl: "http://localhost:1234/v1/chat/completions" };
    requestUrlMock.mockResolvedValue({
      status: 200,
      json: {
        choices: [{ message: { content: "not json" } }]
      }
    });

    const result = await generateAiText(args);
    expect(result).toBe("not json");
  });
});
