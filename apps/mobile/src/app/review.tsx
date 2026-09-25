import { router, Stack } from 'expo-router';
import { PartyPopper } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '@/components/category-picker';
import { DetailLine } from '@/components/detail-line';
import { NoteSheet } from '@/components/note-sheet';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useCategoryChoice } from '@/hooks/use-category-choice';
import { useTheme } from '@/hooks/use-theme';
import { transactionName } from '@/lib/merchants';
import {
  useCategories,
  useMarkReviewed,
  useMerchantRules,
  useReviewQueue,
  useSetTransactionNotes,
  useTransaction,
} from '@/lib/queries';
import { leftBehind } from '@/lib/review';

/** The page after the last card. */
const END = 'end';
const VIEWABILITY = { itemVisiblePercentThreshold: 60 };

/**
 * Transaction review (Phase 8): one transaction per full-screen page, like a
 * reel. Swiping up past a card marks it reviewed; scrolling back still edits.
 */
export default function ReviewScreen() {
  const colors = useTheme();
  const { data: ids, error } = useReviewQueue();
  const markReviewed = useMarkReviewed();
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(0);

  // FlatList requires a stable onViewableItemsChanged; it only reports the page.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const to = viewableItems[0]?.index;
    if (to != null) setIndex(to);
  });

  // Mark every card passed going forward, once each.
  const { mutate: mark } = markReviewed;
  const previous = useRef(0);
  const marked = useRef(new Set<string>());
  useEffect(() => {
    for (const i of leftBehind(previous.current, index)) {
      const id = ids?.[i];
      if (id && !marked.current.has(id)) {
        marked.current.add(id);
        mark(id);
      }
    }
    previous.current = index;
  }, [index, ids, mark]);

  const pages = useMemo(() => [...(ids ?? []), END], [ids]);
  const total = ids?.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <Stack.Title>{index < total ? `${index + 1} of ${total}` : 'Review'}</Stack.Title>
      {error ? (
        <AppText tone="negative" style={{ padding: Spacing.md }}>
          Could not load transactions to review.
        </AppText>
      ) : !ids || height === 0 ? (
        <ActivityIndicator style={{ marginTop: Spacing.xl }} color={colors.textDim} />
      ) : (
        <FlatList
          data={pages}
          keyExtractor={(id) => id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
          initialNumToRender={2}
          windowSize={3}
          viewabilityConfig={VIEWABILITY}
          onViewableItemsChanged={onViewable}
          renderItem={({ item }) => (
            <View style={{ height, padding: Spacing.md, justifyContent: 'center' }}>
              {item === END ? <CaughtUp reviewed={total} /> : <ReviewCard id={item} />}
            </View>
          )}
        />
      )}
    </View>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function ReviewCard({ id }: { id: string }) {
  const { data: t } = useTransaction(id);
  const { data: categories = [] } = useCategories();
  const { data: rules = new Map() } = useMerchantRules();
  const chooseCategory = useCategoryChoice();
  const setNotes = useSetTransactionNotes();
  const [picking, setPicking] = useState(false);
  const [noting, setNoting] = useState(false);
  const category = useMemo(() => categories.find((c) => c.id === t?.category_id), [categories, t?.category_id]);

  if (!t) return null;
  const name = transactionName(t, rules);

  return (
    <View style={{ gap: Spacing.lg }}>
      <View style={{ alignItems: 'center', gap: Spacing.xs }}>
        <AppText variant="display" numberOfLines={2} style={{ textAlign: 'center' }}>
          {name}
        </AppText>
        <Amount value={t.amount} size={40} signColor />
        <AppText tone="dim">
          {formatDate(t.date)}
          {t.accounts?.name ? ` · ${t.accounts.name}` : ''}
          {t.accounts?.mask ? ` ···· ${t.accounts.mask}` : ''}
        </AppText>
      </View>

      <Card style={{ paddingVertical: Spacing.xs }}>
        <DetailLine
          label="Category"
          value={category?.name ?? 'Uncategorized'}
          icon={category}
          onPress={() => setPicking(true)}
        />
        <DetailLine label="Memo" value={t.notes ?? 'Add a memo'} dim={!t.notes} onPress={() => setNoting(true)} />
      </Card>

      <AppText variant="caption" tone="dim" style={{ textAlign: 'center' }}>
        Swipe up when it looks right
      </AppText>

      <CategoryPicker
        visible={picking}
        selectedId={t.category_id}
        onSelect={(next) => {
          setPicking(false);
          chooseCategory(t, name, next);
        }}
        onClose={() => setPicking(false)}
      />
      <NoteSheet
        key={`${t.id}-${noting}`}
        visible={noting}
        current={t.notes}
        isSaving={setNotes.isPending}
        onSave={(notes) =>
          setNotes.mutate(
            { transactionId: t.id, notes },
            { onSuccess: () => setNoting(false), onError: (err) => Alert.alert('Could not save', err.message) },
          )
        }
        onClose={() => setNoting(false)}
      />
    </View>
  );
}

function CaughtUp({ reviewed }: { reviewed: number }) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ alignItems: 'center', gap: Spacing.sm, paddingBottom: insets.bottom }}>
      <PartyPopper size={36} color={colors.brand} strokeWidth={1.75} />
      <AppText variant="title">All caught up</AppText>
      <AppText tone="dim" style={{ textAlign: 'center' }}>
        {reviewed > 0
          ? `You reviewed ${reviewed} transaction${reviewed === 1 ? '' : 's'}.`
          : 'Nothing new to review. New transactions land here after each sync.'}
      </AppText>
      <Button title="Done" onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: Spacing.sm }} />
    </View>
  );
}
