import { useState } from 'react';

import { PasswordChecklist } from '@/components/password-checklist';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { PASSWORD_MIN, passwordOk, passwordsMatch } from '@/lib/password';

type Props = {
  visible: boolean;
  email: string;
  isSaving?: boolean;
  error?: string | null;
  onSave: (password: string) => void;
  onClose: () => void;
};

/** Choose a new password, under the same rules as sign-up (Phase 15f). */
export function PasswordSheet({ visible, email, isSaving, error, onSave, onClose }: Props) {
  // Empty on each opening; the screen keys this sheet by visibility.
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');

  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md }}>
      <SheetScroll contentContainerStyle={{ gap: Spacing.md }}>
        <AppText variant="title">New password</AppText>
        <TextField
          label="Password"
          value={value}
          onChangeText={setValue}
          password
          autoComplete="new-password"
          placeholder={`At least ${PASSWORD_MIN} characters`}
          autoFocus
        />
        <TextField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          password
          autoComplete="new-password"
          placeholder="Type it again"
        />
        <PasswordChecklist password={value} email={email} confirm={confirm} />
        {error ? (
          <AppText variant="caption" tone="negative">
            {error}
          </AppText>
        ) : null}
        <Button
          title="Save password"
          loading={isSaving}
          disabled={!passwordOk(value, email) || !passwordsMatch(value, confirm)}
          onPress={() => onSave(value)}
        />
      </SheetScroll>
    </Sheet>
  );
}
