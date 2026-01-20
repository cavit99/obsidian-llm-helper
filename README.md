# AI LLM Helper (Obsidian plugin)

Simple AI helper to help you write in Obsidian. Select text and ask an LLM to rewrite it, or insert new text at the cursor.

## What it does

- Replace the current selection or insert at the cursor
- Works with OpenAI-style `/v1/responses` (OpenAI or local endpoints compatible with Responses API, such as LM Studio)

## Configure

Settings → Community plugins → AI LLM Helper
- API key (required for OpenAI; leave blank for local servers that don’t need auth)
- API base URL (default `https://api.openai.com/v1`, e.g. `http://localhost:1234/v1` for LM Studio, or OpenRouter etc.)
- Model name (e.g. `gpt-5.2`, or your local model id)

## Use

- Select text (or leave none to insert) and run the “Ask AI…” command from the command palette or the editor context menu.
- Add your own hotkey in Settings → Hotkeys → search “Ask AI…” (suggestion: Cmd/Ctrl+Shift+A if it’s free).
- Type a short instruction; Enter key submits.
- Undo any change with Cmd/Ctrl+Z as normal.

## Security

BYOK: your API key is stored locally in your vault’s plugin data in plain text. Use at your own risk; avoid exposing keys in shared vaults.
