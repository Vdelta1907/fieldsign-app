import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }));
import { AccountSettings } from '../src/components/AccountSettings';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(invoke = vi.fn()) {
  render(<AccountSettings session={{ user: { email: 'owner@example.com' } } as any}
    client={{ functions: { invoke } } as any} isCurrent={() => true} onBack={() => {}} />);
  return invoke;
}
test('missing identity password displays a popup without making a server request', () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const invoke = mount();
  fireEvent.change(screen.getByLabelText('New email address'), { target: { value: 'new@example.com' } });
  fireEvent.click(screen.getByText('Verify email change'));
  expect(alert).toHaveBeenCalledWith('Enter your current password to confirm your identity.');
  expect(invoke).not.toHaveBeenCalled();
});
test('email action gives immediate button feedback followed by a success popup', async () => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  let finish!: (value: any) => void;
  mount(vi.fn(() => new Promise(resolve => { finish = resolve; })));
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'test-password' } });
  fireEvent.change(screen.getByLabelText('New email address'), { target: { value: 'new@example.com' } });
  fireEvent.click(screen.getByText('Verify email change'));
  expect(screen.getByText('Verifying email change…')).toBeTruthy();
  finish({ data: { message: 'Check both inboxes.' }, error: null });
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Check both inboxes.'));
});
test('deletion warning can be cancelled before entering the request form', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const invoke = mount();
  fireEvent.click(screen.getByText('Request account deletion'));
  expect(confirm).toHaveBeenCalled();
  expect(screen.queryByLabelText('Type DELETE to confirm your request')).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
});
