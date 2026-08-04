import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUsd, getModelPrices } from '../src/shared/config/modelPrices.js';

test('getModelPrices normalizes dated haiku model aliases', () => {
  const prices = getModelPrices('claude-haiku-4-5-20251001');
  assert.equal(prices.input, 0.8);
  assert.equal(prices.output, 4);
});

test('estimateCostUsd computes input/output/total cost', () => {
  const costs = estimateCostUsd({
    model: 'claude-haiku-4-5',
    inputTokens: 1000,
    outputTokens: 500,
  });

  assert.equal(costs.inputCostUsd, 0.0008);
  assert.equal(costs.outputCostUsd, 0.002);
  assert.equal(costs.totalCostUsd, 0.0028);
});
