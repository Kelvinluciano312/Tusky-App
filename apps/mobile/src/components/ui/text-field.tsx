import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type TextFieldProps = TextInputProps & {
  label: string;
};

export function TextField({ label, style, ...rest }: TextFieldProps) {
  const colors = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ gap: Spacing.xs + 2 }}>
      <AppText variant="label" tone="dim">
        {label}
      </AppText>
      <TextInput
        placeholderTextColor={colors.textDim}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
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
          style,
        ]}
      />
    </View>
  );
}
