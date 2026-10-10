import { MessageCircleQuestion } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { dialog } from '@/components/ui/dialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Chips } from '@/components/ui/chips';
import { TextField } from '@/components/ui/text-field';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isShared, payerLabel } from '@/lib/herd';
import { useAskQuestion, useDismissQuestion, useHerd, useTransactionQuestions } from '@/lib/queries';
import { useSession } from '@/lib/session';

const BODY_MAX = 280;

/**
 * Open questions on one transaction (15d). The person asked sees what to do;
 * tagging who spent it, the memo or reviewing it answers. The asker sees who
 * it waits on.
 */
export function QuestionBanner({ transactionId }: { transactionId: string }) {
  const colors = useTheme();
  const { session } = useSession();
  const me = session?.user.id;
  const { data: herd } = useHerd();
  const { data: questions = [] } = useTransactionQuestions(transactionId);
  const dismiss = useDismissQuestion();
  if (!herd || questions.length === 0) return null;
  const name = (id: string) => payerLabel(id, herd.members);

  return (
    <View style={{ gap: Spacing.sm }}>
      {questions.map((q) => {
        const forMe = q.asked_to === me;
        const mine = q.asked_by === me;
        return (
          <View
            key={q.id}
            style={{
              flexDirection: 'row',
              gap: Spacing.sm,
              padding: Spacing.md,
              borderRadius: Radius.md,
              backgroundColor: colors.elevated,
            }}>
            <MessageCircleQuestion size={20} color={colors.brand} strokeWidth={1.75} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="label">
                {mine ? `You asked ${name(q.asked_to)}` : `${name(q.asked_by)} asks`}
                {q.body ? `: “${q.body}”` : ' what this was'}
              </AppText>
              <AppText variant="caption" tone="dim">
                {forMe
                  ? 'Tag who spent it or add a memo to answer.'
                  : mine
                    ? `Waiting on ${name(q.asked_to)}.`
                    : `Waiting on ${name(q.asked_to)}.`}
              </AppText>
            </View>
            {forMe || mine ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                onPress={() => dismiss.mutate({ id: q.id, asker: mine })}>
                <AppText variant="caption" tone="dim">
                  {mine ? 'Take back' : 'Dismiss'}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** "Ask Annie about this": shared herds only; lands first in their review deck. */
export function AskButton({ transactionId }: { transactionId: string }) {
  const colors = useTheme();
  const { session } = useSession();
  const me = session?.user.id;
  const { data: herd } = useHerd();
  const [open, setOpen] = useState(false);
  if (!herd || !isShared(herd)) return null;
  const others = herd.members.filter((m) => m.user_id !== me);
  if (others.length === 0) return null;
  const label = others.length === 1 ? `Ask ${payerLabel(others[0].user_id, herd.members)} about this` : 'Ask someone about this';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          paddingVertical: Spacing.sm,
          opacity: pressed ? 0.6 : 1,
        })}>
        <MessageCircleQuestion size={18} color={colors.brand} strokeWidth={1.75} />
        <AppText tone="brand" variant="label">
          {label}
        </AppText>
      </Pressable>
      {open ? <AskSheet transactionId={transactionId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AskSheet({ transactionId, onClose }: { transactionId: string; onClose: () => void }) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const me = session?.user.id;
  const { data: herd } = useHerd();
  const ask = useAskQuestion();
  const others = herd?.members.filter((m) => m.user_id !== me) ?? [];
  const [to, setTo] = useState<string | null>(others[0]?.user_id ?? null);
  const [body, setBody] = useState('');
  if (!herd) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      {/* Padding on Android too: a Modal is its own window. */}
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
        behavior="padding">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={{
            ...Layout.sheet,
            backgroundColor: colors.surface,
            borderTopLeftRadius: Radius.xl,
            borderTopRightRadius: Radius.xl,
            paddingTop: Spacing.lg,
            paddingHorizontal: Spacing.md,
            paddingBottom: insets.bottom + Spacing.md,
            gap: Spacing.md,
          }}>
          <AppText variant="title">Ask about this</AppText>
          {others.length > 1 ? (
            <Chips<string | null>
              accessibilityLabel="Who to ask"
              options={others.map((m) => ({ value: m.user_id as string | null, label: payerLabel(m.user_id, herd.members) }))}
              selected={to}
              onSelect={setTo}
            />
          ) : null}
          <TextField
            label="Note (optional)"
            value={body}
            onChangeText={setBody}
            maxLength={BODY_MAX}
            placeholder="What was this for?"
            autoFocus
          />
          <AppText variant="caption" tone="dim">
            It goes to the front of their Review, with your note.
          </AppText>
          <Button
            title={to ? `Ask ${payerLabel(to, herd.members)}` : 'Ask'}
            disabled={!to}
            loading={ask.isPending}
            onPress={() =>
              to &&
              ask.mutate(
                { transactionId, askedTo: to, body: body.trim() || null },
                { onSuccess: onClose, onError: (err) => dialog.alert('Could not ask', err.message) },
              )
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
