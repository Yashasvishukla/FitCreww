import type { Session } from 'next-auth';

export function isPlatformOperator(session: Session | null): boolean {
  const userId = session?.user?.id;
  if (!userId) return false;
  const configured = (process.env.PLATFORM_ADMIN_USER_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return configured.includes(userId);
}
