import type { SupabaseClient } from '@supabase/supabase-js';

export class AccountAccessUnavailable extends Error {
  constructor() {
    super('Account access is currently unavailable. You cannot save changes while access is blocked. Contact support if you believe this is a mistake.');
  }
}

export async function requireProfileAccess(client: SupabaseClient): Promise<void> {
  const { data, error } = await client.rpc('signforth_my_account_access_allowed');
  if (error || typeof data !== 'boolean') {
    throw new Error('We couldn’t check your account access. Check your connection and try again.');
  }
  if (!data) throw new AccountAccessUnavailable();
}
