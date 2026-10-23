import { useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { validateDisplayName } from '@/lib/merchants';

type Props = {
  visible: boolean;
  /** The name shown today: the current rename, or Plaid's. */
  current: string;
  /** Plaid's name, which "Use the bank's name" returns to. */
  original: string;
  /** Whether a rename exists to remove. */
  renamed: boolean;
  isSaving?: boolean;
  onSave: (name: string) => void;
  onReset: () => void;
  onClose: () => void;
};

/** Rename a merchant everywhere it shows. Android has no Alert.prompt, so a sheet. */
export function RenameSheet({ visible, current, original, renamed, isSaving, onSave, onReset, onClose }: Props) {
  // Seeded once per mount; the screen keys this sheet by merchant.
  const [value, setValue] = useState(current);
  const valid = validateDisplayName(value);

  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md }}>
      <SheetScroll contentContainerStyle={{ gap: Spacing.md }}>
        <AppText variant="title">Rename merchant</AppText>
        <TextField label="Name" value={value} onChangeText={setValue} maxLength={60} placeholder={original} />
        <AppText variant="caption" tone="dim">
          Shows everywhere this merchant appears: transactions, Recurring and Upcoming.
        </AppText>
        <Button
          title="Save"
          disabled={!valid || valid === current}
          loading={isSaving}
          onPress={() => valid && onSave(valid)}
        />
        {renamed ? <Button title={`Use the bank's name (${original})`} variant="ghost" onPress={onReset} /> : null}
      </SheetScroll>
    </Sheet>
  );
}
