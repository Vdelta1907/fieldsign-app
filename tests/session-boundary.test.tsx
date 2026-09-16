import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useState } from 'react';

const mock = vi.hoisted(() => ({ callback: undefined as any, lease: undefined as any, session: null as any,
  getUser: vi.fn(), signOut: vi.fn() }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange: (callback: any) => { mock.callback = callback; callback('INITIAL_SESSION', mock.session); return { data: { subscription: { unsubscribe() {} } } }; },
  getUser: mock.getUser, signOut: mock.signOut,
} } }));
vi.mock('../src/components/AuthScreen', () => ({ AuthScreen: () => <p>Login screen</p> }));
vi.mock('../src/App', () => ({ default: ({ session, isCurrent }: any) => {
  mock.lease = isCurrent;
  const [value, setValue] = useState('');
  return <><p>{session.user.id}</p><input aria-label="Private draft" value={value} onChange={e => setValue(e.target.value)} /></>;
} }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mock.session = null; window.history.replaceState({}, '', '/'); });
afterEach(cleanup);
const login = (id: string) => act(() => mock.callback('SIGNED_IN', { user: { id } }));

test('switching accounts destroys private UI state and invalidates old request leases immediately', async () => {
  const { default: Boundary } = await import('../src/components/SessionBoundary');
  render(<Boundary />);
  login('account-a');
  fireEvent.change(screen.getByLabelText('Private draft'), { target: { value: 'A private business details' } });
  const oldLease = mock.lease;
  login('account-b');
  expect(oldLease()).toBe(false);
  expect((screen.getByLabelText('Private draft') as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('account-a')).toBeNull();
  login('account-a');
  expect(oldLease()).toBe(false);
  expect((screen.getByLabelText('Private draft') as HTMLInputElement).value).toBe('');
});

test('token refresh preserves the same user draft; sign-out destroys it', async () => {
  const { default: Boundary } = await import('../src/components/SessionBoundary');
  render(<Boundary />); login('account-a');
  fireEvent.change(screen.getByLabelText('Private draft'), { target: { value: 'unsaved' } });
  act(() => mock.callback('TOKEN_REFRESHED', { user: { id: 'account-a' } }));
  expect((screen.getByLabelText('Private draft') as HTMLInputElement).value).toBe('unsaved');
  act(() => mock.callback('SIGNED_OUT', null));
  expect(screen.queryByLabelText('Private draft')).toBeNull();
  expect(screen.getByText('Login screen')).toBeTruthy();
});

test('verification never mounts the dashboard and subsequent login works without refreshing', async () => {
  window.history.replaceState({}, '', '/?email-verified=1');
  mock.session = { user: { id: 'verified-account' } };
  mock.getUser.mockResolvedValue({ data: { user: { email_confirmed_at: '2026-09-15' } }, error: null });
  mock.signOut.mockImplementation(async () => { mock.callback('SIGNED_OUT', null); return { error: null }; });
  const { default: Boundary } = await import('../src/components/SessionBoundary');
  render(<Boundary />);
  await screen.findByText('Email verified');
  expect(screen.queryByLabelText('Private draft')).toBeNull();
  fireEvent.click(screen.getByText('Go to Login'));
  await waitFor(() => expect(screen.getByText('Login screen')).toBeTruthy());
  login('verified-account');
  expect(screen.getByLabelText('Private draft')).toBeTruthy();
});

test.each(['query', 'hash'])('first email-change confirmation in %s needs no session and never opens a dashboard', async (location) => {
  if (location === 'query') mock.session = { user: { id: 'already-signed-in' } };
  const message = encodeURIComponent('Confirmation link accepted. Please proceed to confirm link sent to the other email');
  window.history.replaceState({}, '', location === 'query'
    ? `/?email-verified=1&message=${message}` : `/?email-verified=1#message=${message}`);
  mock.getUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') });
  const { default: Boundary } = await import('../src/components/SessionBoundary');
  render(<Boundary />);
  await screen.findByText('Check your other inbox');
  expect(mock.getUser).not.toHaveBeenCalled();
  expect(mock.signOut).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Private draft')).toBeNull();
  expect(screen.queryByText('Email address updated')).toBeNull();
});

test('second email-change confirmation validates the user and closes the callback session', async () => {
  window.history.replaceState({}, '', '/?email-verified=1#type=email_change');
  mock.getUser.mockResolvedValue({ data: { user: { email: 'new@example.com', email_confirmed_at: '2026-09-16' } }, error: null });
  mock.signOut.mockResolvedValue({ error: null });
  const { default: Boundary } = await import('../src/components/SessionBoundary');
  render(<Boundary />);
  await screen.findByText('Email address updated');
  expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(screen.queryByLabelText('Private draft')).toBeNull();
});

test('an expired or reused link cannot be mistaken for a successful confirmation', async () => {
  window.history.replaceState({}, '', '/?email-verified=1#error_description=Email+link+is+invalid+or+has+expired');
  const { default: Boundary } = await import('../src/components/SessionBoundary');
  render(<Boundary />);
  await screen.findByText('Verification unavailable');
  expect(screen.getByRole('alert').textContent).toBe('Email link is invalid or has expired');
  expect(mock.getUser).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Private draft')).toBeNull();
});
