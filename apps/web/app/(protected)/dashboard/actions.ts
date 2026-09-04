'use server';

import { auth, signOut } from '@/auth';

export type SessionCheckState = {
  message?: string;
};

export async function verifyServerSession(): Promise<SessionCheckState> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    throw new Error('Unauthenticated server action invocation.');
  }

  return { message: `Server session verified for ${session.user.email}.` };
}

export async function signOutFromDashboard() {
  await signOut({ redirectTo: '/sign-in' });
}
