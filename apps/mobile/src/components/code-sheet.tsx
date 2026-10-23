import { CodeEntry } from '@/components/code-entry';
import { AppText } from '@/components/ui/app-text';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { Spacing } from '@/constants/theme';

type Props = {
  visible: boolean;
  title: string;
  /** What this code is for, above the field. */
  message: string;
  sentAt: number | null;
  sendError?: string | null;
  onSubmit: (code: string) => Promise<string | null>;
  onResend: () => void;
  onClose: () => void;
};

/**
 * Ask for an emailed code in a bottom sheet (Phase 16e), for switching two-step
 * sign-in on or off. The screen keys this sheet by visibility, so the field
 * starts empty on each opening.
 */
export function CodeSheet({ visible, title, message, sentAt, sendError, onSubmit, onResend, onClose }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} style={{ paddingTop: Spacing.lg, paddingHorizontal: Spacing.md }}>
      <SheetScroll contentContainerStyle={{ gap: Spacing.md }}>
        <AppText variant="title">{title}</AppText>
        <AppText tone="dim">{message}</AppText>
        <CodeEntry sentAt={sentAt} sendError={sendError} onSubmit={onSubmit} onResend={onResend} />
      </SheetScroll>
    </Sheet>
  );
}
