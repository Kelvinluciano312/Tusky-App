import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { payerLabel } from '@/lib/herd';
import type { HerdMember } from '@/lib/queries';
import { cleanSplit, evenSplit, validateSplit } from '@/lib/settle';

type Props = {
  visible: boolean;
  members: HerdMember[];
  /** The purchase's size, positive, for the live dollar amounts. */
  total: number;
  /** The split already saved, if any. */
  current: Record<string, number> | null;
  onSave: (split: Record<string, number>) => void;
  onClose: () => void;
};

const asText = (n: number | undefined) => (n ? String(n) : '');

/** One share typed; between two people, the other becomes the rest of 100. */
function withShare(values: Record<string, string>, id: string, text: string, members: HerdMember[]) {
  const next = { ...values, [id]: text };
  const n = Number(text.replace(',', '.'));
  if (members.length === 2 && text.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100) {
    const other = members.find((m) => m.user_id !== id)!;
    next[other.user_id] = asText(Math.round((100 - n) * 100) / 100);
  }
  return next;
}

/**
 * A custom split (Phase 11b): a percent per member, with the dollars each one
 * comes to. Opens on the saved split, or an even one. The parent keys it per
 * transaction, so reopening starts fresh.
 */
export function SplitSheet({ visible, members, total, current, onSave, onClose }: Props) {
  const colors = useTheme();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const start = current ?? evenSplit(members.map((m) => m.user_id));
    return Object.fromEntries(members.map((m) => [m.user_id, asText(start[m.user_id])]));
  });

  const percents = Object.fromEntries(
    Object.entries(values).map(([id, v]) => [id, v.trim() === '' ? 0 : Number(v.replace(',', '.'))]),
  );
  const problem = validateSplit(percents);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      avoidKeyboard
      style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md, gap: Spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="title">Split</AppText>
        <Button
          title="Evenly"
          variant="ghost"
          onPress={() => {
            const even = evenSplit(members.map((m) => m.user_id));
            setValues(Object.fromEntries(members.map((m) => [m.user_id, asText(even[m.user_id])])));
          }}
        />
      </View>

      {members.map((m) => (
        <View key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
          <AppText variant="label" style={{ flex: 1 }}>
            {payerLabel(m.user_id, members)}
          </AppText>
          <Amount value={(total * (percents[m.user_id] || 0)) / 100} size={14} />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              width: 88,
              height: 40,
              paddingHorizontal: Spacing.sm,
              borderRadius: Radius.md,
              backgroundColor: colors.elevated,
            }}>
            <TextInput
              accessibilityLabel={`${payerLabel(m.user_id, members)}'s share`}
              value={values[m.user_id]}
              onChangeText={(text) => setValues((v) => withShare(v, m.user_id, text, members))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textDim}
              style={{ flex: 1, fontFamily: Type.mono, fontSize: 15, color: colors.text, padding: 0, textAlign: 'right' }}
            />
            <AppText tone="dim"> %</AppText>
          </View>
        </View>
      ))}

      <AppText variant="caption" tone={problem ? 'negative' : 'dim'}>
        {problem ?? 'Leave someone at 0% to keep them out of it.'}
      </AppText>

      <Button title="Save split" disabled={problem !== null} onPress={() => onSave(cleanSplit(percents))} />
    </Sheet>
  );
}
