import { describe, expect, it } from 'vitest';
import { start } from '../src/index.js';

describe('worker skeleton', () => {
  it('starts without throwing', () => {
    expect(() => start()).not.toThrow();
  });
});
