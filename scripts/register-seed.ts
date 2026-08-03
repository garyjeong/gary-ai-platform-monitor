import { registerAdapter } from '../packages/core/src/index.ts';
import { claudeAdapter } from '../packages/adapters/claude/src/index.ts';
import { codexAdapter } from '../packages/adapters/codex/src/index.ts';
import { grokAdapter } from '../packages/adapters/grok/src/index.ts';

export function registerSeedAdapters(): void {
  registerAdapter(claudeAdapter);
  registerAdapter(codexAdapter);
  registerAdapter(grokAdapter);
}
