import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderClassifierGateway } from '../src/shared/ai/providerFactory.js';
import { AppError } from '../src/shared/errors/AppError.js';

function createRegistry({ anthropicClient, geminiClient, ollamaClient, defaultProvider = 'anthropic' }) {
  const providers = new Map();

  if (anthropicClient) {
    providers.set('anthropic', { name: 'anthropic', model: 'claude-haiku-4-5', client: anthropicClient });
  }

  if (geminiClient) {
    providers.set('gemini', { name: 'gemini', model: 'gemini-2.5-flash', client: geminiClient });
  }

  providers.set('ollama', { name: 'ollama', model: 'llama3.2:1b', client: ollamaClient });

  return {
    providers,
    defaultProvider,
    availableProviders: Array.from(providers.keys()),
  };
}

test('gateway classify falls back to ollama when default anthropic fails with 502 and provider not explicit', async () => {
  const gateway = createProviderClassifierGateway(
    createRegistry({
      anthropicClient: {
        async classify() {
          throw new AppError('Anthropic authentication failed. Check ANTHROPIC_API_KEY.', 502);
        },
      },
      ollamaClient: {
        async classify() {
          return {
            parsedInput: {
              temperature: 'warm',
              confidence: 0.7,
              reasoning: 'Fallback local OK',
            },
            inputTokens: 10,
            outputTokens: 5,
          };
        },
      },
    })
  );

  const result = await gateway.classify({
    systemPrompt: 'system',
    userPrompt: 'user',
  });

  assert.equal(result.providerUsed, 'ollama');
  assert.equal(result.modelUsed, 'llama3.2:1b');
  assert.equal(result.parsedInput.temperature, 'warm');
});

test('gateway classify does not fallback when provider is explicitly anthropic', async () => {
  const gateway = createProviderClassifierGateway(
    createRegistry({
      anthropicClient: {
        async classify() {
          throw new AppError('Anthropic authentication failed. Check ANTHROPIC_API_KEY.', 502);
        },
      },
      ollamaClient: {
        async classify() {
          return {
            parsedInput: {
              temperature: 'hot',
              confidence: 0.9,
              reasoning: 'Should not be used',
            },
            inputTokens: 20,
            outputTokens: 10,
          };
        },
      },
    })
  );

  await assert.rejects(
    () => gateway.classify({ systemPrompt: 'system', userPrompt: 'user', provider: 'anthropic' }),
    (error) => {
      assert.equal(error instanceof AppError, true);
      assert.equal(error.statusCode, 502);
      return true;
    }
  );
});

test('gateway classifyMany falls back to ollama when default anthropic batch fails', async () => {
  const gateway = createProviderClassifierGateway(
    createRegistry({
      anthropicClient: {
        async classifyMany() {
          throw new AppError('Classification provider unavailable', 502);
        },
      },
      ollamaClient: {
        async classifyMany() {
          return {
            parsedInput: {
              classifications: [
                {
                  leadId: 'lead-1',
                  temperature: 'cold',
                  confidence: 0.4,
                  reasoning: 'Fallback batch local OK',
                },
              ],
            },
            inputTokens: 12,
            outputTokens: 8,
          };
        },
      },
    })
  );

  const result = await gateway.classifyMany({
    systemPrompt: 'system',
    userPrompt: 'user',
    batchSize: 1,
  });

  assert.equal(result.providerUsed, 'ollama');
  assert.equal(result.modelUsed, 'llama3.2:1b');
  assert.equal(Array.isArray(result.parsedInput.classifications), true);
});

test('gateway classify falls back to ollama when default gemini fails with 502 and provider not explicit', async () => {
  const gateway = createProviderClassifierGateway(
    createRegistry({
      defaultProvider: 'gemini',
      geminiClient: {
        async classify() {
          throw new AppError('Gemini authentication failed. Check GEMINI_API_KEY.', 502);
        },
      },
      ollamaClient: {
        async classify() {
          return {
            parsedInput: {
              temperature: 'hot',
              confidence: 0.85,
              reasoning: 'Gemini failed, local fallback succeeded.',
            },
            inputTokens: 15,
            outputTokens: 9,
          };
        },
      },
    })
  );

  const result = await gateway.classify({
    systemPrompt: 'system',
    userPrompt: 'user',
  });

  assert.equal(result.providerUsed, 'ollama');
  assert.equal(result.modelUsed, 'llama3.2:1b');
});
