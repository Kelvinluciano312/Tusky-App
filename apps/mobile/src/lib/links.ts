import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { dialog } from '@/components/ui/dialog';
import { openResolvedLink, type LinkHow } from './open-link.ts';

const opener = {
  openBrowser: (url: string) => WebBrowser.openBrowserAsync(url),
  openURL: (url: string) => Linking.openURL(url),
  alert: (title: string, message?: string) => {
    dialog.alert(title, message);
  },
};

/**
 * Open a link the person tapped. Never rejects.
 *
 * `page` (legal pages, and any other web page) uses the in-app browser, then
 * Linking.openURL. `system` (Manage subscription) stays on Linking.openURL:
 * that address belongs to the store, not to a page we host.
 */
export function openLink(url: string | Promise<string>, how: LinkHow = 'page'): Promise<void> {
  return openResolvedLink(url, how, opener);
}
