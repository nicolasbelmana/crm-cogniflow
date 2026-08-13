import { AppError } from '../errors/AppError.js';
import { createAnthropicClassifierClient } from './anthropicClassifierClient.js';
import { createGeminiClassifierClient } from './geminiClassifierClient.js';
import { createOllamaClassifierClient } from './ollamaClassifierClient.js';

const PROVIDER_ANTHROPIC = 'anthropic';
const PROVIDER_GEMINI = 'gemini';
const PROVIDER_OLLAMA = 'ollama';
const CLOUD_PROVIDERS = new Set([PROVIDER_ANTHROPIC, PROVIDER_GEMINI]);

export function normalizeProviderName(provider) {
  return String(provider ?? '').trim().toLowerCase();
}

export function createClassifierProviders(config) {
  const providers = new Map();

  providers.set(
    PROVIDER_OLLAMA,
    {
      name: PROVIDER_OLLAMA,
      model: config.ai.ollamaModel,
      client: createOllamaClassifierClient({
        baseUrl: config.ai.ollamaBaseUrl,
        model: config.ai.ollamaModel,
        timeoutMs: config.ai.ollamaTimeoutMs,
      }),
    }
  );

  if (config.ai.anthropicApiKey) {
    providers.set(
      PROVIDER_ANTHROPIC,
      {
        name: PROVIDER_ANTHROPIC,
        model: config.ai.anthropicModel,
        client: createAnthropicClassifierClient({
          apiKey: config.ai.anthropicApiKey,
          model: config.ai.anthropicModel,
          enablePromptCache: config.usage.enablePromptCache,
        }),
      }
    );
  }

  if (config.ai.geminiApiKey) {
    providers.set(
      PROVIDER_GEMINI,
      {
        name: PROVIDER_GEMINI,
        model: config.ai.geminiModel,
        client: createGeminiClassifierClient({
          apiKey: config.ai.geminiApiKey,
          model: config.ai.geminiModel,
          timeoutMs: config.ai.geminiTimeoutMs,
        }),
      }
    );
  }

  const requestedDefault = normalizeProviderName(config.ai.provider);
  let defaultProvider = providers.get(requestedDefault);

  if (!defaultProvider) {
    defaultProvider = providers.get(PROVIDER_ANTHROPIC) ?? providers.get(PROVIDER_GEMINI) ?? providers.get(PROVIDER_OLLAMA);
  }

  if (!defaultProvider) {
    throw new AppError('No AI providers are configured', 500);
  }

  return {
    providers,
    defaultProvider: defaultProvider.name,
    availableProviders: Array.from(providers.keys()),
  };
}

function resolveProviderConfig({ providers, defaultProvider, availableProviders }, providerName) {
  const requestedName = normalizeProviderName(providerName || defaultProvider);
  const providerConfig = providers.get(requestedName);

  if (!providerConfig) {
    throw new AppError(
      `Unsupported provider '${providerName}'. Available providers: ${availableProviders.join(', ')}`,
      400,
      {},
      'INVALID_PROVIDER'
    );
  }

  return providerConfig;
}

function shouldFallbackToLocal(error) {
  if (!(error instanceof AppError)) {
    return false;
  }

  if (error.statusCode === 429) {
    return false;
  }

  if (error.statusCode === 502 || error.statusCode === 503 || error.statusCode === 504) {
    return true;
  }

  return false;
}

export function createProviderClassifierGateway(registry) {
  const { providers, defaultProvider, availableProviders } = registry;

  async function runWithFallback({ provider, runPrimary, runFallback }) {
    const requestedProvider = normalizeProviderName(provider);
    const hasExplicitProvider = requestedProvider.length > 0;
    const primaryProvider = resolveProviderConfig({ providers, defaultProvider, availableProviders }, provider);

    try {
      const result = await runPrimary(primaryProvider);
      return {
        ...result,
        providerUsed: primaryProvider.name,
        modelUsed: primaryProvider.model,
      };
    } catch (error) {
      const fallbackProvider = providers.get(PROVIDER_OLLAMA);
      const canFallback =
        !hasExplicitProvider &&
        CLOUD_PROVIDERS.has(primaryProvider.name) &&
        Boolean(fallbackProvider) &&
        shouldFallbackToLocal(error);

      if (!canFallback) {
        throw error;
      }

      if (process.env.NODE_ENV !== 'production') {
        console.warn('[providerFactory] Falling back to ollama after cloud provider failure:', {
          message: error.message,
          statusCode: error.statusCode,
          provider: primaryProvider.name,
        });
      }

      const fallbackResult = await runFallback(fallbackProvider);
      return {
        ...fallbackResult,
        providerUsed: fallbackProvider.name,
        modelUsed: fallbackProvider.model,
      };
    }
  }

  return {
    resolveProvider(providerName) {
      const providerConfig = resolveProviderConfig({ providers, defaultProvider, availableProviders }, providerName);
      return {
        providerName: providerConfig.name,
        modelUsed: providerConfig.model,
      };
    },

    async classify({ systemPrompt, userPrompt, provider }) {
      return runWithFallback({
        provider,
        runPrimary: (providerConfig) => providerConfig.client.classify({ systemPrompt, userPrompt }),
        runFallback: (providerConfig) => providerConfig.client.classify({ systemPrompt, userPrompt }),
      });
    },

    async classifyMany({ systemPrompt, userPrompt, batchSize, provider }) {
      return runWithFallback({
        provider,
        runPrimary: (providerConfig) => {
          if (!providerConfig.client.classifyMany) {
            throw new AppError('Batch classification not supported by provider', 501);
          }

          return providerConfig.client.classifyMany({
            systemPrompt,
            userPrompt,
            batchSize,
          });
        },
        runFallback: (providerConfig) => {
          if (!providerConfig.client.classifyMany) {
            throw new AppError('Batch classification not supported by provider', 501);
          }

          return providerConfig.client.classifyMany({
            systemPrompt,
            userPrompt,
            batchSize,
          });
        },
      });
    },
  };
}
