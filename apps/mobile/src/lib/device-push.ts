import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { disableNotifications, enableNotifications, loadDevicePush } from '@/lib/push';
import { pushMasterState, type PushMasterState } from '@/lib/push-status';

/** This phone's notification switch: OS permission and its own push_tokens row. */
export function useDevicePush(userId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['push-device', userId],
    enabled: !!userId,
    queryFn: loadDevicePush,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['push-device', userId] });
    void queryClient.invalidateQueries({ queryKey: ['push-tokens', userId] });
  };

  const enable = useMutation({ mutationFn: enableNotifications, onSettled: refresh });
  const disable = useMutation({ mutationFn: disableNotifications, onSettled: refresh });

  const permission = query.data?.permission ?? 'undetermined';
  const tokenRegistered = query.data?.tokenRegistered ?? false;
  const state: PushMasterState = query.data
    ? pushMasterState({ permission, tokenRegistered })
    : 'off';

  return {
    state,
    error: query.data?.error ?? null,
    loading: query.isLoading,
    pending: enable.isPending || disable.isPending,
    enable,
    disable,
  };
}
