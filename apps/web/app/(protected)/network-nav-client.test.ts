import { describe, expect, it } from 'vitest';
import { getVisibleNavLinks } from './network-nav-client';

describe('role navigation', () => {
  it('limits organization admins to organization features', () => {
    expect(getVisibleNavLinks(['OrgAdmin']).map((link) => link.label)).toEqual(['Organizations', 'Clients', 'Nutrition', 'Training', 'Account']);
  });
  it('shows Overview only to owner admins', () => {
    expect(getVisibleNavLinks(['OwnerAdmin']).map((link) => link.label)).toContain('Overview');
    expect(getVisibleNavLinks(['Coach']).map((link) => link.label)).not.toContain('Overview');
    expect(getVisibleNavLinks(['Client']).map((link) => link.label)).not.toContain('Overview');
  });
  it('gives coaches access to collections but not coach management', () => {
    const labels = getVisibleNavLinks(['Coach']).map((link) => link.label);
    expect(labels).toContain('Money');
    expect(labels).not.toContain('Coaches');
    expect(labels).toContain('Earnings');
  });
});
