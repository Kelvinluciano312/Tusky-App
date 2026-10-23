import { Component, type ReactNode } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';

import { Palette, Radius, Spacing } from '@/constants/theme';
import { reportRenderedError } from '@/lib/sentry';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last resort when a screen throws while rendering. System type, not Fraunces:
 * this has to draw even when the font load is what failed. Retry remounts the
 * tree under it.
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    reportRenderedError(error);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) return <CrashFallback onRetry={this.retry} />;
    return this.props.children;
  }
}

function CrashFallback({ onRetry }: { onRetry: () => void }) {
  const colors = useColorScheme() === 'light' ? Palette.light : Palette.dark;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: Spacing.lg }}>
      <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: Spacing.md }}>
        <Text style={{ color: colors.text, fontSize: 22, fontWeight: '600' }}>Something went wrong</Text>
        <Text style={{ color: colors.textDim, fontSize: 16, lineHeight: 22 }}>
          Tusky ran into a problem showing this screen. Trying again usually clears it.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => ({
            backgroundColor: colors.brand,
            borderRadius: Radius.md,
            paddingVertical: 14,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}>
          <Text style={{ color: colors.onBrand, fontSize: 16, fontWeight: '600' }}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}
