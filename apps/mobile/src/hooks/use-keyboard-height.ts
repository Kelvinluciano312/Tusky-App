import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, useWindowDimensions, type KeyboardEvent } from 'react-native';

import { keyboardOverlap } from '@/lib/sheet-keyboard';

/**
 * Height of the keyboard overlapping the window. iOS reports the frame before
 * it animates in; Android reports it once the keyboard is up (`will*` events
 * are not delivered there).
 */
export function useKeyboardHeight(): number {
  const { height: windowHeight } = useWindowDimensions();
  const [overlap, setOverlap] = useState(() => {
    const metrics = Keyboard.metrics();
    return metrics ? keyboardOverlap(metrics, Dimensions.get('window').height) : 0;
  });

  useEffect(() => {
    const apply = (event: KeyboardEvent) => {
      setOverlap(keyboardOverlap(event.endCoordinates, windowHeight));
    };
    const clear = () => setOverlap(0);
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subscriptions = [Keyboard.addListener(show, apply), Keyboard.addListener(hide, clear)];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [windowHeight]);

  return overlap;
}
