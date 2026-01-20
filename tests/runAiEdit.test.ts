import { describe, it, expect, beforeEach, vi } from "vitest";
import ObsidianAiLlmHelperPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/types";
import { Notice } from "obsidian";

const mockGenerate = vi.fn();

vi.mock("../src/openai", () => ({
  generateAiText: (...args: unknown[]) => mockGenerate(...args)
}));

type Pos = { line: number; ch: number };

class MockEditor {
  text: string;
  private selStart: number;
  private selEnd: number;

  constructor(text: string, cursorOffset: number, selectionEnd?: number) {
    this.text = text;
    this.selStart = cursorOffset;
    this.selEnd = selectionEnd ?? cursorOffset;
  }

  getValue(): string {
    return this.text;
  }

  getSelection(): string {
    return this.text.slice(this.selStart, this.selEnd);
  }

  getCursor(which: "from" | "to" = "to"): Pos {
    const offset = which === "from" ? this.selStart : this.selEnd;
    return this.offsetToPos(offset);
  }

  posToOffset(pos: Pos): number {
    const lines = this.text.split("\n");
    let offset = 0;
    for (let i = 0; i < pos.line; i++) {
      offset += (lines[i]?.length ?? 0) + 1; // +1 for newline
    }
    return offset + pos.ch;
  }

  private offsetToPos(offset: number): Pos {
    const lines = this.text.split("\n");
    let remaining = offset;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i]?.length ?? 0;
      if (remaining <= len) return { line: i, ch: remaining };
      remaining -= len + 1; // skip newline
    }
    return { line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 };
  }

  replaceSelection(content: string): void {
    this.text = this.text.slice(0, this.selStart) + content + this.text.slice(this.selEnd);
    this.selEnd = this.selStart + content.length;
  }

  replaceRange(content: string, from: Pos, to?: Pos): void {
    const start = this.posToOffset(from);
    const end = to ? this.posToOffset(to) : start;
    this.text = this.text.slice(0, start) + content + this.text.slice(end);
    this.selStart = start;
    this.selEnd = start + content.length;
  }

  getLine(line: number): string {
    return this.text.split("\n")[line] ?? "";
  }
}

describe("runAiEdit insert heuristics", () => {
  let plugin: ObsidianAiLlmHelperPlugin;

  beforeEach(() => {
    mockGenerate.mockReset();
    (Notice as any).messages = [];
    plugin = new ObsidianAiLlmHelperPlugin({} as any, {} as any);
    plugin.settings = {
      ...DEFAULT_SETTINGS,
      apiBaseUrl: "http://localhost:1234/v1", // avoid API key requirement
      openAiApiKey: ""
    };
  });

  it("fills a bullet stub without duplicating markers", async () => {
    const doc = "Workspace\n- Desk\n- \n";
    const cursor = doc.indexOf("- \n") + 2; // after "- "
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("- Mail handling");

    await plugin.runAiEdit(editor as any, "insert", "add another");

    expect(editor.text).toBe("Workspace\n- Desk\n- Mail handling\n");
  });

  it("preserves nested bullet indentation across multiple lines", async () => {
    const doc = "- Parent\n  - \n";
    const cursor = doc.indexOf("  - ") + 4;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("- Child one\n- Child two");

    await plugin.runAiEdit(editor as any, "insert", "add children");

    expect(editor.text).toBe("- Parent\n  - Child one\n  - Child two\n");
  });

  it("preserves deeper nested bullets returned by the model", async () => {
    const doc = "- Parent\n  - \n";
    const cursor = doc.indexOf("  - ") + 4;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("- Child\n  - Grandchild");

    await plugin.runAiEdit(editor as any, "insert", "add children");

    expect(editor.text).toBe("- Parent\n  - Child\n    - Grandchild\n");
  });

  it("keeps ordered list numbering from the stub line", async () => {
    const doc = "1. First\n2. \n";
    const cursor = doc.indexOf("2. ") + 3;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("3. Second item");

    await plugin.runAiEdit(editor as any, "insert", "add second");

    expect(editor.text).toBe("1. First\n2. Second item\n");
  });

  it("prefixes blockquote inserts to keep quoting intact", async () => {
    const doc = "> Quote\n> \n";
    const cursor = doc.indexOf("> \n") + 2;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("Another line");

    await plugin.runAiEdit(editor as any, "insert", "add quote");

    expect(editor.text).toBe("> Quote\n> Another line\n");
  });

  it("avoids doubling quote markers when the model includes them", async () => {
    const doc = "> Quote\n> \n";
    const cursor = doc.indexOf("> \n") + 2;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("> Already quoted");

    await plugin.runAiEdit(editor as any, "insert", "add quote");

    expect(editor.text).toBe("> Quote\n> Already quoted\n");
  });

  it("strips outer fences when inserting inside a fenced code block", async () => {
    const doc = "```\ncode line\n\n```\n";
    const lines = doc.split("\n");
    const cursor = (lines[0]?.length ?? 0) + 1 + (lines[1]?.length ?? 0) + 1; // start of blank line inside fence
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("```\nnewCall();\n```");

    await plugin.runAiEdit(editor as any, "insert", "add code");

    expect(editor.text).toBe("```\ncode line\nnewCall();\n```\n");
  });

  it("keeps fences when inserting outside code blocks", async () => {
    const doc = "Intro\n\n";
    const cursor = doc.length;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("```\nblock\n```");

    await plugin.runAiEdit(editor as any, "insert", "add fenced");

    expect(editor.text).toBe("Intro\n\n```\nblock\n```");
  });

  it("trims extra leading/trailing blank lines at insertion boundaries", async () => {
    const doc = "Intro\n\n";
    const cursor = doc.length;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("\n\nMore text\n");

    await plugin.runAiEdit(editor as any, "insert", "add more");

    expect(editor.text).toBe("Intro\n\nMore text\n");
  });

  it("keeps plain-text spacing conservative when model sends extra newlines", async () => {
    const doc = "Hello\n";
    const cursor = doc.length;
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("\n\nWorld\n\n");

    await plugin.runAiEdit(editor as any, "insert", "add");

    expect(editor.text).toBe("Hello\n\nWorld\n");
  });

  it("ensures a paragraph fits between two paragraphs with single blank lines", async () => {
    const doc = "Para1\n\n\nPara2\n";
    const cursor = doc.indexOf("\n\n") + 1; // on the middle blank line
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("Inserted paragraph");

    await plugin.runAiEdit(editor as any, "insert", "add paragraph");

    expect(editor.text).toBe("Para1\n\nInserted paragraph\n\nPara2\n");
  });

  it("adds a newline before inserting list items at end of a list line", async () => {
    const doc = "- A\n- B\n- Quiet space";
    const cursor = doc.length; // end of last line
    const editor = new MockEditor(doc, cursor);
    mockGenerate.mockResolvedValue("- Good lighting\n- Ergonomic chair");

    await plugin.runAiEdit(editor as any, "insert", "add items");

    expect(editor.text).toBe("- A\n- B\n- Quiet space\n- Good lighting\n- Ergonomic chair");
  });
});
