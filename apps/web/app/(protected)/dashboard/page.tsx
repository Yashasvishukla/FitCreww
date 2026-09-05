import { auth } from '@/auth';
import { signOutFromDashboard } from './actions';
import { SessionCheck } from './session-check';
import { NetworkNav } from '../network-nav';

export default async function DashboardPage() {
  const session = await auth();

  return (
    <main className="dashboard-page">
      <NetworkNav />
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">FitCrew</p>
          <h1>Authenticated session</h1>
          <p className="muted">Signed in as {session?.user?.email}</p>
        </div>
        <form action={signOutFromDashboard}>
          <button className="secondary-button" type="submit">Sign out</button>
        </form>
      </header>
      <section className="session-panel" aria-label="Session verification">
        <h2>Server action check</h2>
        <SessionCheck />
      </section>
    </main>
  );
}
