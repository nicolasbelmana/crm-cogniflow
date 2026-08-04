const MODEL_PRICES_USD_PER_MILLION = {
  'claude-haiku-4-5': {
    input: 0.8,
    output: 4,
  },
};

function normalizeModel(model) {
  if (!model || typeof model !== 'string') {
    return 'claude-haiku-4-5';
  }

  if (model.startsWith('claude-haiku-4-5')) {
    return 'claude-haiku-4-5';
  }

  return model;
}

export function getModelPrices(model) {
  const normalized = normalizeModel(model);
  return MODEL_PRICES_USD_PER_MILLION[normalized] ?? MODEL_PRICES_USD_PER_MILLION['claude-haiku-4-5'];
}

export function estimateCostUsd({ model, inputTokens = 0, outputTokens = 0 }) {
  const prices = getModelPrices(model);
  const inputCost = (Math.max(0, Number(inputTokens) || 0) / 1_000_000) * prices.input;
  const outputCost = (Math.max(0, Number(outputTokens) || 0) / 1_000_000) * prices.output;
  const totalCost = inputCost + outputCost;

  return {
    inputCostUsd: inputCost,
    outputCostUsd: outputCost,
    totalCostUsd: totalCost,
  };
}

export function getAllModelPrices() {
  return MODEL_PRICES_USD_PER_MILLION;
}
