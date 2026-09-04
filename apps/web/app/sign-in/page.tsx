import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SignInForm } from './sign-in-form';

export default async function SignInPage() {
  const session = await auth();
  if (session?.user?.id) redirect('/dashboard');

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="sign-in-title">
        <p className="eyebrow">FitCrew</p>
        <h1 id="sign-in-title">Sign in</h1>
        <p className="muted">Use your FitCrew account to continue.</p>
        <SignInForm />
      </section>
    </main>
  );
}
