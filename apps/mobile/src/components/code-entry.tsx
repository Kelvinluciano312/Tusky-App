import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';
import { Spacing, Type } from '@/constants/theme';
import { codeComplete, codeFull, resendLabel, resendSecondsLeft, sanitizeCode } from '@/lib/two-factor';

type Props = {
  /** When the code was last sent (epoch ms); null when nothing has been sent, so Resend is open. */
  sentAt: number | null;
  /** A failed send, shown above the field. */
  sendError?: string | null;
  /** Check the code. Resolves to an error message, or null when it was accepted. */
  onSubmit: (code: string) => Promise<string | null>;
  /** Ask for another code. */
  onResend: () => void;
  submitTitle?: string;
};

/**
 * The emailed code field with its Verify and Resend buttons (Phase 16e), shared
 * by the sign-in code screen and the Account & privacy sheet. It submits by
 * itself at the last digit, so a pasted or auto-filled code needs no tap.
 */
export function CodeEntry({ sentAt, sendError, onSubmit, onResend, submitTitle = 'Verify' }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A second submit while one is in flight (auto-submit plus a tap) would burn the single-use code.
  const inFlight = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  const counting = sentAt !== null && resendSecondsLeft(sentAt, now) > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting, sentAt]);

  // `now` can lag a fresh send by up to a second; a new sentAt is always in the future of it.
  const left = sentAt === null ? 0 : resendSecondsLeft(sentAt, Math.max(now, sentAt));

  const submit = async (value: string) => {
    if (inFlight.current || !codeComplete(value)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(value);
    inFlight.current = false;
    // On success the screen unmounts or closes; setting state then would warn.
    if (failure) {
      setBusy(false);
      setError(failure);
      setCode('');
    }
  };

  return (
    <View style={{ gap: Spacing.md }}>
      <TextField
        label="Code from the email"
        value={code}
        onChangeText={(raw) => {
          const next = sanitizeCode(raw);
          setCode(next);
          if (codeFull(next)) void submit(next);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        placeholder="12345678"
        autoFocus
        style={{ fontFamily: Type.mono, fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
      />
      {sendError ? (
        <AppText variant="caption" tone="negative">
          {sendError}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="caption" tone="negative">
          {error}
        </AppText>
      ) : null}
      <Button title={submitTitle} loading={busy} disabled={!codeComplete(code)} onPress={() => void submit(code)} />
      <Button title={resendLabel(left)} variant="ghost" disabled={left > 0 || busy} onPress={onResend} />
    </View>
  );
}
