import { describe, expect, it } from 'vitest';
import { modelCost } from './providers';

describe('modelCost', () => {
  it('reads OpenRouter free models from the «:free» suffix', () => {
    expect(modelCost('openrouter', 'deepseek/deepseek-chat-v3-0324:free')).toBe('free');
    expect(modelCost('openrouter', 'x-ai/grok-4-fast')).toBe('paid');
    // «free» inside the id is not the suffix.
    expect(modelCost('openrouter', 'vendor/free-model')).toBe('paid');
  });

  it('treats a provider without a chosen model as free, never as paid', () => {
    expect(modelCost('openrouter', '')).toBe('free');
    expect(modelCost('openrouter', undefined)).toBe('free');
  });

  it('counts Ollama as local and Gemini as free, whatever the model is', () => {
    expect(modelCost('ollama', 'llama3.1')).toBe('local');
    expect(modelCost('ollama', '')).toBe('local');
    expect(modelCost('gemini', 'gemini-2.5-flash')).toBe('free');
  });
});
