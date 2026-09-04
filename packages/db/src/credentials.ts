import type { PrismaClient, User } from '@prisma/client';
import { authPrisma } from './auth-prisma.js';
import { verifyPassword } from './password.js';

const MAX_FAILED_SIGN_INS = 5;
const LOCKOUT_MINUTES = 15;

// Keeps the response timing similar when an address does not identify an
// account, avoiding an account-existence signal during credential stuffing.
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$StSiWm6/xvC/R/F/GXJqlQ$vYK77Io89gNQL1//6TvxnntLy3dx1pd4yrLo03aF6Os';

export type AuthenticatedUser = Pick<User, 'id' | 'email' | 'name' | 'image'>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function authenticateUser(
  email: string,
  password: string,
  prisma: PrismaClient = authPrisma,
  now = new Date(),
): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });

  if (!user || !user.passwordHash || (user.lockedUntil && user.lockedUntil > now)) {
    await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    return null;
  }

  const passwordMatches = await verifyPassword(user.passwordHash, password);
  if (!passwordMatches) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedSignInAttempts: { increment: 1 } },
      select: { failedSignInAttempts: true },
    });

    if (updated.failedSignInAttempts >= MAX_FAILED_SIGN_INS) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedSignInAttempts: 0,
          lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000),
        },
      });
    }

    return null;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedSignInAttempts: 0, lockedUntil: null },
  });

  return { id: user.id, email: user.email, name: user.name, image: user.image };
}
