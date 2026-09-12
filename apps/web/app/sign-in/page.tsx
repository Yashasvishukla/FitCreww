import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { SignInForm } from './sign-in-form';

export default async function SignInPage({ searchParams }: { searchParams: { callbackUrl?: string } }) {
  const session = await auth();
  const redirectTo = safeRedirectPath(searchParams.callbackUrl);
  if (session?.user?.id) redirect(redirectTo);

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="sign-in-title">
        <p className="eyebrow">FitCrew</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="muted">Use your FitCrew account to continue.</p>
        <SignInForm redirectTo={redirectTo} />
      </section>
    </main>
  );
}
