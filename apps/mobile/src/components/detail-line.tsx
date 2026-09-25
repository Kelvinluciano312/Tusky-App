import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Category } from '@/lib/queries';

/** One labelled row of a transaction's details; tappable when it opens an editor. */
export function DetailLine({
  label,
  value,
  icon,
  dim,
  onPress,
}: {
  label: string;
  value: string;
  icon?: Category;
  /** A placeholder value, like "Add a memo". */
  dim?: boolean;
  onPress?: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.sm + 2,
        opacity: pressed ? 0.7 : 1,
      })}>
      <AppText variant="label" tone="dim" style={{ width: 92 }}>
        {label}
      </AppText>
      {icon ? (
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: Radius.full,
            backgroundColor: colors.elevated,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <CategoryIcon name={icon.icon} size={13} color={icon.color} />
        </View>
      ) : null}
      <AppText style={{ flex: 1 }} tone={dim ? 'dim' : undefined} numberOfLines={2}>
        {value}
      </AppText>
      {onPress ? <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} /> : null}
    </Pressable>
  );
}
