import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';

import { shouldClearCache } from '@/lib/session-cache';
import { supabase } from '@/lib/supabase';

type SessionState = {
  session: Session | null;
  /** True until the persisted session has been restored from storage. */
  isLoading: boolean;
};

const SessionContext = createContext<SessionState>({ session: null, isLoading: true });

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      lastUserId.current = data.session?.user.id ?? null;
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      // Server-side session ends and user switches never pass a sign-out button.
      if (shouldClearCache(lastUserId.current, next?.user.id)) queryClient.clear();
      lastUserId.current = next?.user.id ?? null;
      setSession(next);
    });

    return () => subscription.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <SessionContext.Provider value={{ session, isLoading }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
