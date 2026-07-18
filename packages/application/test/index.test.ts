import { describe, expect, it } from 'vitest';
import {
  CLIENT_LIFECYCLE_MODULE,
  IDENTITY_ACCESS_MODULE,
  MEDIA_MODULE,
  MONEY_MODULE,
  NETWORK_MODULE,
  NOTIFICATIONS_MODULE,
  PLATFORM_MODULE,
} from '../src/index.js';

describe('@fitcrew/application module barrels', () => {
  it('exposes exactly the seven modules named in Architecture §12', () => {
    expect([
      IDENTITY_ACCESS_MODULE,
      NETWORK_MODULE,
      CLIENT_LIFECYCLE_MODULE,
      MONEY_MODULE,
      MEDIA_MODULE,
      PLATFORM_MODULE,
      NOTIFICATIONS_MODULE,
    ]).toEqual([
      'identity-access',
      'network',
      'client-lifecycle',
      'money',
      'media',
      'platform',
      'notifications',
    ]);
  });
});
