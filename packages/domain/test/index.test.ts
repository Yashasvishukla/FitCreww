import { describe, expect, it } from 'vitest';
import { DOMAIN_PACKAGE_NAME } from '../src/index.js';

describe('@fitcrew/domain package skeleton', () => {
  it('resolves and exports its public barrel', () => {
    expect(DOMAIN_PACKAGE_NAME).toBe('@fitcrew/domain');
  });
});
