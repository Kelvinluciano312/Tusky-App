// Pure logic behind the app's dialogs (Phase 16f). Same shape as React
// Native's system alert, so a call site only changes its function name.

export type DialogButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export type DialogRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  /** Only an explicit `false` makes the scrim and back button inert. */
  cancelable?: boolean;
};

export type DialogOptions = { cancelable?: boolean };

/** No buttons means a single OK, as the system alert does. A button with no text reads OK. */
export function normalizeButtons(buttons?: DialogButton[]): DialogButton[] {
  if (!buttons || buttons.length === 0) return [{ text: 'OK' }];
  return buttons.map((b) => ({ ...b, text: b.text || 'OK' }));
}

/** The button a scrim tap or the back button stands for: the cancel one, if any. */
export function cancelButton(buttons: DialogButton[]): DialogButton | undefined {
  return buttons.find((b) => b.style === 'cancel');
}

/** The dialog on screen is the head of the queue; a new one waits behind it. */
export function enqueue(queue: DialogRequest[], request: DialogRequest): DialogRequest[] {
  return [...queue, request];
}

export function dismissHead(queue: DialogRequest[]): DialogRequest[] {
  return queue.slice(1);
}

/** Two buttons share a row; one or three-plus stack, so long labels never squeeze. */
export function layoutFor(buttons: DialogButton[]): 'row' | 'column' {
  return buttons.length === 2 ? 'row' : 'column';
}

/** Only one plain button reads as the main action; several share the quiet look. */
export function lookFor(button: DialogButton, buttons: DialogButton[]): 'primary' | 'secondary' | 'destructive' {
  if (button.style === 'destructive') return 'destructive';
  if (button.style === 'cancel') return 'secondary';
  const plain = buttons.filter((b) => b.style !== 'cancel' && b.style !== 'destructive');
  return plain.length === 1 ? 'primary' : 'secondary';
}

/** What a scrim tap or the back button does: the cancel button, a plain dismiss, or nothing if the call said not cancelable. */
export function dismissAction(request: Pick<DialogRequest, 'buttons' | 'cancelable'>): 'none' | 'dismiss' | 'cancel' {
  if (request.cancelable === false) return 'none';
  return cancelButton(request.buttons) ? 'cancel' : 'dismiss';
}
