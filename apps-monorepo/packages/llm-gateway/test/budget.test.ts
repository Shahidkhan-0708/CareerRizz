import { describe, it, expect, vi } from 'vitest';
import { MemoryBudgetStore, BudgetExceededError, estimateCostUsd, LLMGateway, loadRouterConfig } from '../src/index.js';

describe('MemoryBudgetStore', () => {
  it('accumulates spend per key', async () => {
    const store = new MemoryBudgetStore();
    expect(await store.incrSpend('k', 0.5)).toBeCloseTo(0.5);
    expect(await store.incrSpend('k', 0.25)).toBeCloseTo(0.75);
    expect(parseFloat((await store.get('k')) ?? '0')).toBeCloseTo(0.75);
  });

  it('keeps keys isolated', async () => {
    const store = new MemoryBudgetStore();
    await store.incrSpend('a', 1);
    expect(await store.get('b')).toBeNull();
  });

  it('expires keys after TTL', async () => {
    const store = new MemoryBudgetStore();
    // Simulate a pre-expired entry by writing then rewinding the clock.
    await store.incrSpend('k', 1);
    const entry = (store as unknown as { ledger: Map<string, { value: string; expiresAt: number }> }).ledger.get('k')!;
    entry.expiresAt = Date.now() - 1;
    expect(await store.get('k')).toBeNull();
  });
});

describe('estimateCostUsd', () => {
  it('computes input+output cost from the rate table', () => {
    // gpt-4o: $2.5/1M input, $10/1M output
    expect(estimateCostUsd('gpt-4o', 1_000_000, 100_000)).toBeCloseTo(2.5 + 1.0);
    // unknown model falls back to $1/$2
    expect(estimateCostUsd('mystery-model', 1_000_000, 0)).toBeCloseTo(1);
  });
});

describe('LLMGateway budget enforcement', () => {
  function makeGateway(budget = 0.01) {
    const config = { ...loadRouterConfig({ OPENAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv), dailyBudgetUsd: budget };
    return new LLMGateway(config, new MemoryBudgetStore());
  }

  it('throws BudgetExceededError BEFORE calling the API when the estimate exceeds budget', async () => {
    const gateway = makeGateway(0.0001); // absurdly small
    await expect(
      gateway.complete({
        tier: 'sonnet',
        system: 's',
        prompt: 'p',
        parse: () => ({}),
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('does not hit the network when budget blocks the call', async () => {
    const gateway = makeGateway(0.000001);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      gateway.complete({ tier: 'haiku', system: 's', prompt: 'p', parse: () => ({}) }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
