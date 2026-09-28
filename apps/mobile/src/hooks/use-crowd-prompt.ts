import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { afterFix, parsePromptState } from '@/lib/crowd-prompt';
import { useCrowdConsent, useSetCrowdConsent } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Call after each category fix. On the third, once, asks whether to share
 * fixes with the crowd. Counted per device and user: a nudge, not a record.
 * Storage failures are ignored; the Settings switch is always there.
 */
export function useCrowdPrompt() {
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: consented } = useCrowdConsent(userId);
  const setConsent = useSetCrowdConsent();

  return () => {
    if (!userId) return;
    const key = `crowd-prompt:${userId}`;
    void (async () => {
      try {
        const { state, ask } = afterFix(parsePromptState(await AsyncStorage.getItem(key)), consented ?? false);
        await AsyncStorage.setItem(key, JSON.stringify(state));
        if (!ask) return;
        Alert.alert(
          'Help Tusky get smarter?',
          'Share your category fixes, with no name attached, so everyone’s transactions sort themselves. ' +
            'You can turn this off in Settings, which deletes what you shared.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Share',
              onPress: () =>
                setConsent.mutate(true, {
                  onError: () => Alert.alert('Could not change that', 'Check your connection and try again.'),
                }),
            },
          ],
        );
      } catch {
        // A nudge is not worth an error.
      }
    })();
  };
}
