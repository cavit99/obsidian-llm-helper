# AI LLM Helper (Obsidian plugin)

Simple yet effective modern AI helper to help you write in Obsidian. Select text and ask an LLM to rewrite it, or insert new text at the cursor.

## What it does

- Rewrite selected text or insert AI-generated text at your cursor position, guided by any prompt.
- Works with any endpoint that supports the OpenAI-style Responses API, including OpenAI and local services like LM Studio, Ollama, and others

## Configure

Settings → Community plugins → AI LLM Helper
- API key (stored as an Obsidian secret; per-device, not synced; leave blank if your local model doesn’t need auth)
- API base URL (default `https://api.openai.com/v1`, e.g. `http://localhost:1234/v1` for LM Studio, or OpenRouter etc.)
- Model name (e.g. `gpt-5.2`, or your local model id)
- Requires Obsidian 1.11.4 or newer (for SecretStorage support).

## Use

- Select text (or leave none to insert) and run the “Ask AI…” command from the command palette or the editor context menu.
- Add your own hotkey in Settings → Hotkeys → search “Ask AI…” (suggestion: Cmd/Ctrl+Shift+A if it’s free).
- Type a short instruction; Enter key submits.
- Undo any change with Cmd/Ctrl+Z as normal.

## Security

Secrets are stored via Obsidian SecretStorage (per-device, not synced). For hosted APIs, keep your vault private and avoid sharing secrets. For local models that don’t require auth, you can leave the key empty.
