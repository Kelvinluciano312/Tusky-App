import { Text, type TextProps } from 'react-native';

import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'display' | 'title' | 'section' | 'body' | 'label' | 'caption';

const variantStyles: Record<Variant, { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number }> = {
  /** Fraunces — screen greetings and marquee moments */
  display: { fontFamily: Type.display, fontSize: 28, lineHeight: 34 },
  /** Fraunces — card and modal titles */
  title: { fontFamily: Type.displayMedium, fontSize: 20, lineHeight: 26 },
  /** Figtree — section headers in lists */
  section: { fontFamily: Type.bodySemiBold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: Type.body, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: Type.bodyMedium, fontSize: 14, lineHeight: 19 },
  caption: { fontFamily: Type.body, fontSize: 12.5, lineHeight: 17, letterSpacing: 0.2 },
};

type AppTextProps = TextProps & {
  variant?: Variant;
  /** 'dim' renders secondary color; pass a palette color name for others */
  tone?: 'default' | 'dim' | 'brand' | 'positive' | 'negative';
};

export function AppText({ variant = 'body', tone = 'default', style, ...rest }: AppTextProps) {
  const colors = useTheme();
  const color =
    tone === 'dim' ? colors.textDim
    : tone === 'brand' ? colors.brand
    : tone === 'positive' ? colors.positive
    : tone === 'negative' ? colors.negative
    : colors.text;

  return <Text {...rest} style={[variantStyles[variant], { color }, style]} />;
}
