import { router, Stack } from 'expo-router';
import { Check, Clock3, PartyPopper, Undo2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { ReviewCard } from '@/components/review-card';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useReviewQueue, useSetReviewed } from '@/lib/queries';
import { type Deck, deckReducer, type DeckMove, newDeck, topCard } from '@/lib/review';

/** How far a card must travel, in points, before letting go commits the swipe. */
const THRESHOLD = 110;
/** A flick this fast commits however short the drag. */
const FLING_VELOCITY = 900;

type Fling = { dir: 'accept' | 'skip'; nonce: number } | null;

/**
 * Transaction review as a deck of cards (Phase 10): swipe right when a card
 * looks right, left to come back to it later. Fixing it (category, name,
 * memo, who paid) happens on the card itself. Undo takes back the last swipe.
 */
export default function ReviewScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data: ids, error } = useReviewQueue();
  const setReviewed = useSetReviewed();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [fling, setFling] = useState<Fling>(null);

  // The queue is a per-visit snapshot; the deck starts from it once.
  if (ids && !deck) setDeck(newDeck(ids));

  const top = deck ? topCard(deck) : null;
  const next = deck && top ? deck.queue.find((id) => id !== top && !deck.skipped.includes(id)) : undefined;
  const total = ids?.length ?? 0;
  const remaining = deck ? deck.queue.filter((id) => !deck.skipped.includes(id)).length : 0;

  const apply = (move: DeckMove) => {
    if (!deck) return;
    if (move.type === 'accept' && top) setReviewed.mutate({ transactionId: top, reviewed: true });
    if (move.type === 'undo') {
      const last = deck.history.at(-1);
      if (last?.move === 'accept') setReviewed.mutate({ transactionId: last.id, reviewed: false });
    }
    setDeck(deckReducer(deck, move));
    setFling(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Title>{deck && top ? `${deck.accepted} of ${total} reviewed` : 'Review'}</Stack.Title>
      {error ? (
        <AppText tone="negative" style={{ padding: Spacing.md }}>
          Could not load transactions to review.
        </AppText>
      ) : !deck ? (
        <ActivityIndicator style={{ marginTop: Spacing.xl }} color={colors.textDim} />
      ) : !top ? (
        <CaughtUp reviewed={deck.accepted} skipped={deck.skipped.length} canUndo={deck.history.length > 0} onUndo={() => apply({ type: 'undo' })} />
      ) : (
        <View style={{ flex: 1, paddingHorizontal: Spacing.md, paddingBottom: insets.bottom + Spacing.md }}>
          <Progress done={deck.accepted} total={total} />

          <View style={{ flex: 1, justifyContent: 'center' }}>
            <View>
            {/* Plain card edges peek out underneath, so the deck reads as a deck: one
                edge when a single card follows, two when more do. */}
            {remaining > 2 ? <DeckEdge inset={Spacing.lg} drop={20} /> : null}
            {next ? <DeckEdge inset={Spacing.sm + 2} drop={10} /> : null}
            <SwipeCard
              key={top}
              id={top}
              fling={fling}
              onAccept={() => apply({ type: 'accept' })}
              onSkip={() => apply({ type: 'skip' })}
            />
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm }}>
            <RoundButton label="Later" onPress={() => setFling({ dir: 'skip', nonce: Date.now() })}>
              <Clock3 size={21} color={colors.text} strokeWidth={2} />
            </RoundButton>
            <Pressable
              disabled={deck.history.length === 0}
              onPress={() => apply({ type: 'undo' })}
              accessibilityLabel="Undo"
              style={({ pressed }) => ({ padding: Spacing.sm, opacity: deck.history.length === 0 ? 0.3 : pressed ? 0.6 : 1 })}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Undo2 size={18} color={colors.textDim} strokeWidth={2} />
                <AppText variant="caption" tone="dim">
                  Undo
                </AppText>
              </View>
            </Pressable>
            <RoundButton label="Looks right" primary onPress={() => setFling({ dir: 'accept', nonce: Date.now() })}>
              <Check size={22} color={colors.onBrand} strokeWidth={2.5} />
            </RoundButton>
          </View>
          <AppText variant="caption" tone="dim" style={{ textAlign: 'center', marginTop: Spacing.sm }}>
            Swipe right when it looks right · left for later
          </AppText>
        </View>
      )}
    </View>
  );
}

/** The top card, draggable. Its key is the transaction, so every card starts centred. */
function SwipeCard({
  id,
  fling,
  onAccept,
  onSkip,
}: {
  id: string;
  fling: Fling;
  onAccept: () => void;
  onSkip: () => void;
}) {
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const offscreen = width * 1.4;

  // The buttons throw the card the same way a finger would.
  useEffect(() => {
    if (!fling) return;
    const accept = fling.dir === 'accept';
    x.set(withTiming(accept ? offscreen : -offscreen, { duration: 240 }, (finished) => {
      if (finished) scheduleOnRN(accept ? onAccept : onSkip);
    }));
  }, [fling, offscreen, onAccept, onSkip, x]);

  const pan = Gesture.Pan()
    // Horizontal drags only, so taps and the sheets' own scrolling still work.
    .activeOffsetX([-12, 12])
    .failOffsetY([-24, 24])
    .onChange((e) => {
      x.set(x.get() + e.changeX);
      y.set(y.get() + e.changeY * 0.25);
    })
    .onEnd((e) => {
      const right = x.get() > THRESHOLD || e.velocityX > FLING_VELOCITY;
      const left = x.get() < -THRESHOLD || e.velocityX < -FLING_VELOCITY;
      if (right || left) {
        x.set(withTiming(right ? offscreen : -offscreen, { duration: 200 }, (finished) => {
          if (finished) scheduleOnRN(right ? onAccept : onSkip);
        }));
      } else {
        x.set(withSpring(0, { damping: 16, stiffness: 180 }));
        y.set(withSpring(0, { damping: 16, stiffness: 180 }));
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: y.get() },
      // A small tilt, like a card held at one corner.
      { rotate: `${interpolate(x.get(), [-width, 0, width], [-14, 0, 14])}deg` },
    ],
  }));
  const acceptStamp = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [20, THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const laterStamp = useAnimatedStyle(() => ({
    opacity: interpolate(x.get(), [-THRESHOLD, -20], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={cardStyle}>
        <ReviewCard id={id} />
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: Spacing.lg, left: Spacing.lg }, acceptStamp]}>
          <Stamp label="REVIEWED" color={colors.positive} rotate="-14deg" />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: Spacing.lg, right: Spacing.lg }, laterStamp]}>
          <Stamp label="LATER" color={colors.gold} rotate="14deg" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** The edge of a card waiting under the top one: narrower, and dropped a little lower. */
function DeckEdge({ inset, drop }: { inset: number; drop: number }) {
  const colors = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: drop,
        bottom: -drop,
        left: inset,
        right: inset,
        borderRadius: Radius.xl,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: 0.7,
      }}
    />
  );
}

function Stamp({ label, color, rotate }: { label: string; color: string; rotate: string }) {
  return (
    <View
      style={{
        borderWidth: 3,
        borderColor: color,
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 2,
        transform: [{ rotate }],
      }}>
      <AppText variant="section" style={{ color, fontSize: 20, lineHeight: 26, letterSpacing: 1.5 }}>
        {label}
      </AppText>
    </View>
  );
}

function RoundButton({
  label,
  primary,
  onPress,
  children,
}: {
  label: string;
  primary?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ alignItems: 'center', gap: Spacing.xs, opacity: pressed ? 0.7 : 1, minWidth: 88 })}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: Radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: primary ? colors.brand : colors.elevated,
          borderWidth: primary ? 0 : 1,
          borderColor: colors.border,
        }}>
        {children}
      </View>
      <AppText variant="caption" tone="dim">
        {label}
      </AppText>
    </Pressable>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const colors = useTheme();
  const share = total > 0 ? done / total : 0;
  return (
    <View style={{ height: 4, borderRadius: Radius.full, backgroundColor: colors.elevated, marginTop: Spacing.sm, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(share * 100)}%`, height: 4, backgroundColor: colors.brand }} />
    </View>
  );
}

function CaughtUp({
  reviewed,
  skipped,
  canUndo,
  onUndo,
}: {
  reviewed: number;
  skipped: number;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.md, paddingBottom: insets.bottom }}>
      <PartyPopper size={40} color={colors.brand} strokeWidth={1.75} />
      <AppText variant="title">{skipped > 0 ? 'Done for now' : 'All caught up'}</AppText>
      <AppText tone="dim" style={{ textAlign: 'center' }}>
        {reviewed > 0 ? `You reviewed ${reviewed} transaction${reviewed === 1 ? '' : 's'}.` : 'Nothing new to review.'}
        {skipped > 0 ? ` ${skipped} ${skipped === 1 ? 'waits' : 'wait'} for next time.` : ''}
        {reviewed === 0 && skipped === 0 ? ' New transactions land here after each sync.' : ''}
      </AppText>
      <Button title="Done" onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: Spacing.sm }} />
      {canUndo ? <Button title="Undo last" variant="ghost" onPress={onUndo} /> : null}
    </View>
  );
}
