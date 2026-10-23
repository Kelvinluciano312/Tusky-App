import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { DEFAULT_NOTIFICATION_PREFS, showNotificationPrompt } from '@/lib/notifications';
import { enableNotifications } from '@/lib/push';
import { supabase } from '@/lib/supabase';

export type NotificationPrefsRow = typeof DEFAULT_NOTIFICATION_PREFS & {
  user_id: string;
  timezone: string | null;
  prompted_at: string | null;
};

export function displayedPrefs(row: Partial<NotificationPrefsRow> | null | undefined): NotificationPrefsRow {
  return {
    user_id: row?.user_id ?? '',
    timezone: row?.timezone ?? null,
    prompted_at: row?.prompted_at ?? null,
    ...DEFAULT_NOTIFICATION_PREFS,
    ...row,
  };
}

export function useNotificationPrefs(userId: string | undefined) {
  return useQuery({
    queryKey: ['notification-prefs', userId],
    enabled: !!userId,
    queryFn: async (): Promise<NotificationPrefsRow | null> => {
      const { data, error } = await supabase
        .from('notification_prefs')
        .select('*')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return data as NotificationPrefsRow | null;
    },
  });
}

export function useSetNotificationPref(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<typeof DEFAULT_NOTIFICATION_PREFS>) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase
        .from('notification_prefs')
        .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-prefs', userId] });
    },
  });
}

async function markPrompted(userId: string) {
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: userId, prompted_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** The Home card for someone who finished onboarding before notifications existed. */
export function useNotificationPrompt(userId: string | undefined) {
  const queryClient = useQueryClient();
  const prefs = useNotificationPrefs(userId);
  const tokens = useQuery({
    queryKey: ['push-tokens', userId],
    enabled: !!userId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('push_tokens')
        .select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
  const show = !!userId
    && prefs.isSuccess
    && tokens.isSuccess
    && showNotificationPrompt({ promptedAt: prefs.data?.prompted_at ?? null, hasToken: (tokens.data ?? 0) > 0 });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['notification-prefs', userId] });
    void queryClient.invalidateQueries({ queryKey: ['push-tokens', userId] });
  };

  const dismiss = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      await markPrompted(userId);
    },
    onSuccess: refresh,
  });

  const enable = useMutation({
    mutationFn: async () => {
      if (!userId) return 'denied' as const;
      const result = await enableNotifications();
      await markPrompted(userId);
      return result;
    },
    onSuccess: refresh,
  });

  return { show, dismiss, enable };
}

export { markPrompted };
