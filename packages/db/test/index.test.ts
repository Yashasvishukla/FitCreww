import { describe, expect, it } from 'vitest';
import { DB_PACKAGE_NAME } from '../src/index.js';

describe('@fitcrew/db package skeleton', () => {
  it('resolves and exports its public barrel', () => {
    expect(DB_PACKAGE_NAME).toBe('@fitcrew/db');
  });
});
