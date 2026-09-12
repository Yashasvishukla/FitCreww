import { describe, expect, it } from 'vitest';
import { getVisibleNavLinks } from './network-nav-client';

describe('role navigation', () => {
  it('limits organization admins to organization features', () => {
    expect(getVisibleNavLinks(['OrgAdmin']).map((link) => link.label)).toEqual(['Overview', 'Organizations', 'Clients', 'Training', '◉ Account']);
  });
  it('keeps finance and coach management owner-only', () => {
    const labels = getVisibleNavLinks(['Coach']).map((link) => link.label);
    expect(labels).not.toContain('Money');
    expect(labels).not.toContain('Coaches');
    expect(labels).toContain('Earnings');
  });
});
