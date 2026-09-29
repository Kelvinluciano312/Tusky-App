import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { planBanner } from '@/lib/plan-banner';
import { usePlan } from '@/lib/queries';

/** A plan warning (Phase 14b), or nothing. Home and Settings show it; a tap opens the plans (14c). */
export function PlanBanner({ userId }: { userId: string | undefined }) {
  const { data: plan } = usePlan(userId);
  const banner = plan ? planBanner(plan, new Date()) : null;
  if (!banner) return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/paywall')}>
      <Card style={{ gap: Spacing.xs }}>
        <AppText variant="section">{banner.title}</AppText>
        <AppText tone="dim" variant="caption">
          {banner.body}
        </AppText>
        <AppText variant="caption" tone="brand">
          See plans
        </AppText>
      </Card>
    </Pressable>
  );
}
