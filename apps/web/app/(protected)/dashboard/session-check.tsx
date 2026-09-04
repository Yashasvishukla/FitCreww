'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { verifyServerSession, type SessionCheckState } from './actions';

const initialState: SessionCheckState = {};

function CheckButton() {
  const { pending } = useFormStatus();
  return (
    <button className="secondary-button" type="submit" disabled={pending}>
      {pending ? 'Checking...' : 'Verify server session'}
    </button>
  );
}

export function SessionCheck() {
  const [state, formAction] = useFormState(verifyServerSession, initialState);

  return (
    <form action={formAction}>
      <CheckButton />
      {state.message ? <p className="success-message" role="status">{state.message}</p> : null}
    </form>
  );
}
