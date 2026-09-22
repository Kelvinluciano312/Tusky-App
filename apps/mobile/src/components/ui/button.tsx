import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
};

export function Button({ title, variant = 'primary', loading = false, disabled, style, ...rest }: ButtonProps) {
  const colors = useTheme();
  const isDisabled = disabled || loading;

  const background =
    variant === 'primary' ? colors.brand
    : variant === 'secondary' ? colors.elevated
    : 'transparent';
  const textColor = variant === 'primary' ? colors.onBrand : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      {...rest}
      style={(state) => [
        {
          backgroundColor: background,
          borderRadius: Radius.md,
          paddingVertical: 14,
          paddingHorizontal: Spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
          opacity: isDisabled ? 0.5 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <AppText variant="label" style={{ color: textColor, fontSize: 15 }}>
          {title}
        </AppText>
      )}
    </Pressable>
  );
}
