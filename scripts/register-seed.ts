import { registerAdapter, clearAdapters } from '../packages/core/src/index.ts';
import { claudeAdapter } from '../packages/adapters/claude/src/index.ts';
import { codexAdapter } from '../packages/adapters/codex/src/index.ts';
import { grokAdapter } from '../packages/adapters/grok/src/index.ts';
import { geminiAdapter } from '../packages/adapters/gemini/src/index.ts';
import { openrouterAdapter } from '../packages/adapters/openrouter/src/index.ts';
import { cursorAdapter } from '../packages/adapters/cursor/src/index.ts';
import { copilotAdapter } from '../packages/adapters/copilot/src/index.ts';
import { ollamaAdapter } from '../packages/adapters/ollama/src/index.ts';
import { opencodeAdapter } from '../packages/adapters/opencode/src/index.ts';
import { APP_ADAPTERS } from '../packages/adapters/apps/src/index.ts';

export function registerSeedAdapters(): void {
  clearAdapters();
  for (const a of [
    claudeAdapter,
    codexAdapter,
    grokAdapter,
    geminiAdapter,
    openrouterAdapter,
    cursorAdapter,
    copilotAdapter,
    ollamaAdapter,
    opencodeAdapter,
    ...APP_ADAPTERS,
  ]) {
    registerAdapter(a);
  }
}
