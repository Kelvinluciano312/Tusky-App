import { ChevronRight, X } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Chips } from '@/components/ui/chips';
import { Sheet } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Direction, type Filters, NO_FILTERS, parseAmount, type SpentBy } from '@/lib/transaction-filters';

export type TransactionSort = 'newest' | 'oldest' | 'expensive' | 'cheap';

type Props = {
  visible: boolean;
  sort: TransactionSort;
  filters: Filters;
  onSort: (sort: TransactionSort) => void;
  onChange: (filters: Filters) => void;
  onClose: () => void;
  /** The pickers are their own sheets; the screen closes this one and opens them. */
  onPickCategory: () => void;
  onPickMerchant: () => void;
  categoryName: string | null;
  merchantName: string | null;
  accounts: { id: string; name: string }[];
  /** Members by first name plus Joint; empty outside a shared herd. */
  people: { value: SpentBy; label: string }[];
};

/**
 * Filter and sort the feed (Phase 15e). Choices apply as they are made; the
 * screen shows each active one as a removable chip under the search bar.
 * Sections stay short so the sheet reads as a list, not a form.
 */
export function TransactionFilterSheet({
  visible,
  sort,
  filters,
  onSort,
  onChange,
  onClose,
  onPickCategory,
  onPickMerchant,
  categoryName,
  merchantName,
  accounts,
  people,
}: Props) {
  // Typed text, so "12." is not reformatted under the user's thumb. Seeded per
  // opening; the screen keys this sheet by visibility.
  const [minText, setMinText] = useState(filters.min === null ? '' : String(filters.min));
  const [maxText, setMaxText] = useState(filters.max === null ? '' : String(filters.max));
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <Sheet visible={visible} onClose={onClose} avoidKeyboard style={{ maxHeight: '88%', paddingTop: Spacing.lg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.lg, paddingBottom: Spacing.md }}>
        <AppText variant="title">Filter and sort</AppText>

        <Section title="Sort">
          <Chips<TransactionSort>
            accessibilityLabel="Sort"
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'oldest', label: 'Oldest' },
              { value: 'expensive', label: 'Biggest' },
              { value: 'cheap', label: 'Smallest' },
            ]}
            selected={sort}
            onSelect={onSort}
          />
        </Section>

        <Section title="Money">
          <Chips<Direction>
            accessibilityLabel="Money in or out"
            options={[
              { value: 'any', label: 'All' },
              { value: 'out', label: 'Money out' },
              { value: 'in', label: 'Money in' },
            ]}
            selected={filters.direction}
            onSelect={(direction) => set({ direction })}
          />
        </Section>

        <View style={{ gap: Spacing.xs }}>
          <PickRow label="Category" value={categoryName} placeholder="Any category" onPress={onPickCategory} onClear={() => set({ category: null })} />
          <PickRow label="Merchant" value={merchantName} placeholder="Any merchant" onPress={onPickMerchant} onClear={() => set({ merchant: null })} />
        </View>

        <Section title="Amount">
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="From"
                value={minText}
                onChangeText={(text) => {
                  setMinText(text);
                  set({ min: parseAmount(text) });
                }}
                keyboardType="decimal-pad"
                placeholder="$0"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="To"
                value={maxText}
                onChangeText={(text) => {
                  setMaxText(text);
                  set({ max: parseAmount(text) });
                }}
                keyboardType="decimal-pad"
                placeholder="Any"
              />
            </View>
          </View>
        </Section>

        {accounts.length > 1 ? (
          <Section title="Account">
            <Chips<string | null>
              accessibilityLabel="Account"
              options={[{ value: null, label: 'All' }, ...accounts.map((a) => ({ value: a.id as string | null, label: a.name }))]}
              selected={filters.account}
              onSelect={(account) => set({ account })}
            />
          </Section>
        ) : null}

        {people.length > 0 ? (
          <Section title="Spent by">
            <Chips<SpentBy>
              accessibilityLabel="Spent by"
              options={[{ value: 'all', label: 'Everyone' }, ...people]}
              selected={filters.spentBy}
              onSelect={(spentBy) => set({ spentBy })}
            />
          </Section>
        ) : null}

        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Clear all"
              variant="secondary"
              onPress={() => {
                setMinText('');
                setMaxText('');
                onSort('newest');
                onChange(NO_FILTERS);
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Done" onPress={onClose} />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <AppText variant="label" tone="dim">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function PickRow({
  label,
  value,
  placeholder,
  onPress,
  onClear,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
  onClear: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.sm,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <AppText variant="label" tone="dim" style={{ minWidth: 80, flexShrink: 0 }}>
        {label}
      </AppText>
      <AppText variant="label" tone={value ? 'default' : 'dim'} style={{ flex: 1 }} numberOfLines={1}>
        {value ?? placeholder}
      </AppText>
      {value ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel={`Clear ${label.toLowerCase()}`}>
          <X size={16} color={colors.textDim} />
        </Pressable>
      ) : (
        <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
      )}
    </Pressable>
  );
}
