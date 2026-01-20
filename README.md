# AI LLM Helper (Obsidian plugin)

Simple yet effective modern AI helper to help you write in Obsidian. Select text and ask an LLM to rewrite it, or insert new text at the cursor.

## What it does

- Rewrite selected text or insert AI-generated text at your cursor position, guided by any prompt.
- Works with any endpoint that supports the OpenAI-style Responses API, including OpenAI and local services like LM Studio, Ollama, and others.
- Sends the full document plus nearby context around the cursor/selection to the model for higher-quality edits.

## Configure

Settings → Community plugins → AI LLM Helper
- API key (stored as an Obsidian secret; per-device, not synced; leave blank if your local model doesn’t need auth)
- API base URL (default is set for OpenAI; change this to match your local model or preferred endpoint)
- Model name (e.g. `gpt-5.2`, openrouter or local model id)
- Requires Obsidian 1.11.4 or newer (for SecretStorage support).

## Use

- Select text (or leave none to insert) and run the “Ask AI…” command from the command palette or the editor context menu.
- Add your own hotkey in Settings → Hotkeys → search “Ask AI…” (suggestion: Cmd/Ctrl+Shift+A if it’s free).
- Type a short instruction; Enter key submits.
- Undo any change with Cmd/Ctrl+Z as normal.

## Security

Secrets are stored via Obsidian SecretStorage (per-device, not synced). For hosted APIs, keep your vault private and avoid sharing secrets. For local models that don’t require auth, you can leave the key empty.

## Local models: For best results prefer models that support tool/structured outputs (e.g mistral-nemo, gpt-oss etc)

## Disclosures

- Network use: your prompt, entire document, and selection context are sent directly to the configured LLM endpoint.
- The settings page includes a “Buy Me a Coffee” support link. No ads or telemetry are included.
