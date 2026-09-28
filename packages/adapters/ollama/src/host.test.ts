import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OLLAMA_BASE, normalizeOllamaHost } from './host.js';
import { mapOllamaTags } from './index.js';

describe('normalizeOllamaHost', () => {
  it('defaults when unset/blank/invalid', () => {
    assert.equal(normalizeOllamaHost(undefined), DEFAULT_OLLAMA_BASE);
    assert.equal(normalizeOllamaHost('  '), DEFAULT_OLLAMA_BASE);
    assert.equal(normalizeOllamaHost('ftp://x'), DEFAULT_OLLAMA_BASE);
  });

  it('adds http:// and the default port when missing', () => {
    assert.equal(normalizeOllamaHost('127.0.0.1'), 'http://127.0.0.1:11434');
    assert.equal(normalizeOllamaHost('localhost:8080'), 'http://localhost:8080');
    assert.equal(normalizeOllamaHost('gpu-box.local'), 'http://gpu-box.local:11434');
  });

  it('maps the bind-all address to loopback', () => {
    assert.equal(normalizeOllamaHost('0.0.0.0'), 'http://127.0.0.1:11434');
    assert.equal(normalizeOllamaHost('0.0.0.0:11434'), 'http://127.0.0.1:11434');
    assert.equal(normalizeOllamaHost('http://0.0.0.0:9999/'), 'http://127.0.0.1:9999');
  });

  it('keeps explicit scheme/port/path, drops trailing slash', () => {
    assert.equal(normalizeOllamaHost('https://ollama.example.com'), 'https://ollama.example.com');
    assert.equal(normalizeOllamaHost('http://host:80'), 'http://host');
    assert.equal(normalizeOllamaHost('http://host:11434/ollama/'), 'http://host:11434/ollama');
    assert.equal(normalizeOllamaHost('[::1]'), 'http://[::1]:11434');
  });
});

describe('mapOllamaTags', () => {
  it('reports disk usage in bytes (not tokens) and model names as note', () => {
    const r = mapOllamaTags({
      models: [
        { name: 'llama3:8b', size: 4_661_224_676 },
        { name: 'qwen2.5:7b', size: 4_683_087_332 },
        { name: 'broken', size: Number.NaN },
      ],
    });
    const disk = r.windows.find((w) => w.id === 'disk');
    assert.equal(disk?.unit, 'bytes');
    assert.equal(disk?.usedAbsolute, 4_661_224_676 + 4_683_087_332);
    assert.equal(r.windows.find((w) => w.id === 'models')?.usedAbsolute, 3);
    assert.equal(r.note, 'llama3:8b, qwen2.5:7b, broken');
    assert.equal(r.errorMessage, undefined);
  });

  it('tolerates an empty/malformed payload', () => {
    const r = mapOllamaTags(null);
    assert.equal(r.windows.find((w) => w.id === 'disk')?.usedAbsolute, 0);
    assert.equal(r.note, undefined);
  });
});
