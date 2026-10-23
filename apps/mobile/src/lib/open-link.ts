// Opening a link the person tapped. Pure: the screen's helper supplies the
// browser, the system opener, and the alert.

export type LinkHow = 'page' | 'system';

export type LinkOpener = {
  /** In-app browser: SFSafariViewController on iOS, Custom Tabs on Android. */
  openBrowser: (url: string) => Promise<unknown>;
  /** System handler, the same call Linking makes. */
  openURL: (url: string) => Promise<unknown>;
  alert: (title: string, message?: string) => void;
};

export const LINK_FAILED_TITLE = "Couldn't open that link";

/** Shown when both ways of opening a known address fail. The address is the way out. */
export function linkFailedMessage(url: string): string {
  return `Open this address in your browser:\n${url}`;
}

const LINK_UNAVAILABLE = 'Try again in a moment.';

/**
 * Open `url`. A page tries the in-app browser first, then the system.
 * A system link (the store's subscription page) uses only the system handler.
 *
 * Web pages on studiosouroboros.com cannot rely on the system handler. iOS
 * answers `open` with failure — the rejection Sentry records as
 * "Unable to open URL" — when the paywall is a modal, and the same host is
 * the app's associated domain. The in-app browser loads the page itself, so
 * neither of those applies. A failure here is an alert, never a rejection.
 */
export async function openResolvedLink(
  url: string | Promise<string>,
  how: LinkHow,
  opener: LinkOpener,
): Promise<void> {
  let resolved: string;
  try {
    resolved = await url;
  } catch {
    opener.alert(LINK_FAILED_TITLE, LINK_UNAVAILABLE);
    return;
  }

  if (how === 'page') {
    try {
      await opener.openBrowser(resolved);
      return;
    } catch {
      // The in-app browser could not present. The system is the fallback.
    }
  }

  try {
    await opener.openURL(resolved);
  } catch {
    opener.alert(LINK_FAILED_TITLE, linkFailedMessage(resolved));
  }
}
