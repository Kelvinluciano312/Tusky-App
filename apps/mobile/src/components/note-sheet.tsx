import { useState } from 'react';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { NOTE_MAX, normalizeNote } from '@/lib/review';

type Props = {
  visible: boolean;
  current: string | null;
  isSaving?: boolean;
  /** null clears the memo. */
  onSave: (notes: string | null) => void;
  onClose: () => void;
};

/** Write or clear a transaction's memo. A sheet, not an inline field, so the keyboard never fights a paged list. */
export function NoteSheet({ visible, current, isSaving, onSave, onClose }: Props) {
  // Seeded once per mount; callers key this sheet by transaction.
  const [value, setValue] = useState(current ?? '');
  const next = normalizeNote(value);

  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md }}>
      <SheetScroll contentContainerStyle={{ gap: Spacing.md }}>
        <AppText variant="title">Memo</AppText>
        <TextField
          label="What was this?"
          value={value}
          onChangeText={setValue}
          maxLength={NOTE_MAX}
          placeholder="Dinner with Ana, office chair…"
          multiline
          autoFocus
          style={{ minHeight: 88, textAlignVertical: 'top' }}
        />
        <Button title="Save" disabled={next === current} loading={isSaving} onPress={() => onSave(next)} />
        {current ? <Button title="Remove memo" variant="ghost" onPress={() => onSave(null)} /> : null}
      </SheetScroll>
    </Sheet>
  );
}
