import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextFieldProps = TextInputProps & {
  label: string;
  /** A password field with a show/hide button; implies secureTextEntry. */
  password?: boolean;
};

export function TextField({ label, style, password, ...rest }: TextFieldProps) {
  const colors = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);

  return (
    <View style={{ gap: Spacing.xs + 2 }}>
      <AppText variant="label" tone="dim">
        {label}
      </AppText>
      <View>
        <TextInput
          placeholderTextColor={colors.textDim}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
          {...(password ? { secureTextEntry: !shown, autoCapitalize: 'none', autoCorrect: false } : null)}
          style={[
            {
              backgroundColor: colors.elevated,
              borderRadius: Radius.md,
              borderWidth: 1,
              borderColor: focused ? colors.brand : colors.border,
              color: colors.text,
              fontFamily: Type.body,
              fontSize: 15,
              paddingHorizontal: Spacing.md,
              paddingVertical: 12,
            },
            password ? { paddingRight: 48 } : null,
            style,
          ]}
        />
        {password ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setShown((s) => !s)}
            style={{ position: 'absolute', right: Spacing.md, top: 0, bottom: 0, justifyContent: 'center' }}>
            {shown ? (
              <EyeOff size={20} color={colors.textDim} strokeWidth={1.75} />
            ) : (
              <Eye size={20} color={colors.textDim} strokeWidth={1.75} />
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
