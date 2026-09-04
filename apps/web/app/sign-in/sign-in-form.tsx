'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { signInWithCredentials, type SignInState } from './actions';

const initialState: SignInState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? 'Signing in...' : 'Sign in'}
    </button>
  );
}

export function SignInForm() {
  const [state, formAction] = useFormState(signInWithCredentials, initialState);

  return (
    <form action={formAction} className="auth-form">
      <label>
        <span>Email</span>
        <input autoComplete="email" name="email" type="email" required maxLength={320} />
      </label>
      <label>
        <span>Password</span>
        <input autoComplete="current-password" name="password" type="password" required maxLength={1024} />
      </label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
