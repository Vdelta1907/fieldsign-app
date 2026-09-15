import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

// A request begun by one workspace must never acquire another user's token.
export function createWorkspaceClient(userId: string | null, isCurrent: () => boolean) {
  return createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      accessToken: async () => {
        if (!isCurrent()) throw new Error('This account session has ended.');
        if (!userId) return null;
        const { data, error } = await supabase.auth.getSession();
        if (error || !isCurrent() || data.session?.user.id !== userId) {
          throw new Error('This account session has changed. Sign in again.');
        }
        return data.session.access_token;
      },
      global: {
        fetch: async (input, init) => {
          if (!isCurrent()) throw new Error('This account session has ended.');
          const response = await fetch(input, init);
          if (!isCurrent()) throw new Error('This account session has ended.');
          return response;
        },
      },
    },
  );
}
