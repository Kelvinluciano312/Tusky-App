import { Image } from 'expo-image';
import { ChevronDown, Pencil } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { CategoryPicker } from '@/components/category-picker';
import { CategorySheet, type SheetTarget } from '@/components/category-sheet';
import { DetailLine } from '@/components/detail-line';
import { NoteSheet } from '@/components/note-sheet';
import { RenameSheet } from '@/components/rename-sheet';
import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { WhoPaid } from '@/components/who-paid';
import { Radius, Spacing } from '@/constants/theme';
import { useCategoryChoice } from '@/hooks/use-category-choice';
import { useTheme } from '@/hooks/use-theme';
import { transactionName } from '@/lib/merchants';
import {
  useCategories,
  useMerchantRules,
  useSetMerchantRule,
  useSetTransactionNotes,
  useTransaction,
} from '@/lib/queries';

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** A colour at low strength, for tinted surfaces. Accepts #RRGGBB. */
function tint(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${a}` : hex;
}

/**
 * One transaction in the review deck (Phase 10): what it is, how much, and the
 * fixes a review usually needs, all on the card: its category (the big chip),
 * the merchant's name, a memo, and who paid. The deck owns the swiping.
 */
export function ReviewCard({ id }: { id: string }) {
  const colors = useTheme();
  const { data: t } = useTransaction(id);
  const { data: categories = [] } = useCategories();
  const { data: rules = new Map() } = useMerchantRules();
  const chooseCategory = useCategoryChoice();
  const setRule = useSetMerchantRule();
  const setNotes = useSetTransactionNotes();
  const [picking, setPicking] = useState(false);
  const [addTarget, setAddTarget] = useState<SheetTarget | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [noting, setNoting] = useState(false);
  const category = useMemo(() => categories.find((c) => c.id === t?.category_id), [categories, t?.category_id]);

  if (!t) return <View style={{ height: 420 }} />;

  const name = transactionName(t, rules);
  const original = t.merchant_name ?? t.name;
  const merchantKey = t.merchant_key || null;
  const rule = merchantKey ? rules.get(merchantKey) : undefined;
  const accent = category?.color ?? colors.brand;
  const failed = (err: Error) => Alert.alert('Could not save', err.message);

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: Radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
        // Lifted off the page, like a card you could pick up.
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}>
      {/* The category's colour washes the top of the card. */}
      <View style={{ backgroundColor: tint(accent, 0.16), alignItems: 'center', paddingTop: Spacing.lg, paddingBottom: Spacing.md, gap: Spacing.sm }}>
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: Radius.full,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
          {t.logo_url ? (
            <Image source={{ uri: t.logo_url }} style={{ width: 60, height: 60 }} contentFit="cover" />
          ) : (
            <CategoryIcon name={category?.icon} size={26} color={accent} />
          )}
        </View>
        <Pressable
          disabled={!merchantKey}
          onPress={() => setRenaming(true)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, opacity: pressed ? 0.7 : 1, paddingHorizontal: Spacing.md })}>
          <AppText variant="title" numberOfLines={2} style={{ textAlign: 'center', flexShrink: 1 }}>
            {name}
          </AppText>
          {merchantKey ? <Pencil size={14} color={colors.textDim} strokeWidth={2} /> : null}
        </Pressable>
        <Amount value={t.amount} size={38} signColor showPlus />
        <AppText variant="caption" tone="dim">
          {formatDate(t.date)}
          {t.accounts?.name ? ` · ${t.accounts.name}` : ''}
          {t.accounts?.mask ? ` ···· ${t.accounts.mask}` : ''}
          {t.pending ? ' · Pending' : ''}
        </AppText>
      </View>

      <View style={{ padding: Spacing.md, gap: Spacing.xs }}>
        {/* The fix a review needs most often, so it is the biggest control. */}
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityLabel={`Category: ${category?.name ?? 'Uncategorized'}. Tap to change`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            alignSelf: 'center',
            paddingVertical: Spacing.sm,
            paddingLeft: Spacing.sm,
            paddingRight: Spacing.md,
            borderRadius: Radius.full,
            backgroundColor: tint(accent, pressed ? 0.3 : 0.2),
            borderWidth: 1,
            borderColor: tint(accent, 0.45),
          })}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: Radius.full,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <CategoryIcon name={category?.icon} size={15} color={accent} />
          </View>
          <AppText variant="label">{category?.name ?? 'Uncategorized'}</AppText>
          <ChevronDown size={16} color={colors.textDim} strokeWidth={2} />
        </Pressable>
        {rule?.category_id ? (
          <AppText variant="caption" tone="dim" style={{ textAlign: 'center' }}>
            {name} is always {categories.find((c) => c.id === rule.category_id)?.name ?? 'set by a rule'}
          </AppText>
        ) : null}

        <DetailLine label="Memo" value={t.notes ?? 'Add a memo'} dim={!t.notes} onPress={() => setNoting(true)} />
        <WhoPaid transaction={t} />
      </View>

      <CategoryPicker
        visible={picking}
        selectedId={t.category_id}
        onSelect={(next) => {
          setPicking(false);
          chooseCategory(t, name, next);
        }}
        onClose={() => setPicking(false)}
        onRequestAdd={(group) => setAddTarget({ mode: 'add', group })}
      />
      <CategorySheet target={addTarget} onClose={() => setAddTarget(null)} />
      <NoteSheet
        key={`${t.id}-${noting}`}
        visible={noting}
        current={t.notes}
        isSaving={setNotes.isPending}
        onSave={(notes) =>
          setNotes.mutate({ transactionId: t.id, notes }, { onSuccess: () => setNoting(false), onError: failed })
        }
        onClose={() => setNoting(false)}
      />
      {merchantKey ? (
        <RenameSheet
          key={`${merchantKey}-${renaming}`}
          visible={renaming}
          current={name}
          original={original}
          renamed={!!rule?.display_name}
          isSaving={setRule.isPending}
          onSave={(displayName) =>
            setRule.mutate({ merchantKey, displayName }, { onSuccess: () => setRenaming(false), onError: failed })
          }
          onReset={() =>
            setRule.mutate({ merchantKey, displayName: null }, { onSuccess: () => setRenaming(false), onError: failed })
          }
          onClose={() => setRenaming(false)}
        />
      ) : null}
    </View>
  );
}
