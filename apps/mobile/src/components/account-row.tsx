import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Account } from '@/lib/queries';

/** Credit and loan balances count against you. */
export function signedBalance(account: Account): number {
  const balance = account.current_balance ?? 0;
  return account.type === 'credit' || account.type === 'loan' ? -balance : balance;
}

type Props = {
  account: Account;
  onPress?: () => void;
  /** Rendered after the balance — the bank screen's show/hide switch. */
  trailing?: ReactNode;
  /** Not counted in net worth (a disconnected bank): name and balance fade. */
  dimmed?: boolean;
};

export function AccountRow({ account, onPress, trailing, dimmed = false }: Props) {
  const colors = useTheme();
  const detail = [account.mask ? `···· ${account.mask}` : null, account.subtype ?? account.type]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.sm + 2,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: dimmed ? 0.5 : 1,
        }}>
        <View style={{ flexShrink: 1, paddingRight: Spacing.sm }}>
          <AppText variant="label">{account.name}</AppText>
          <AppText variant="caption" tone="dim">
            {detail}
          </AppText>
        </View>
        <Amount value={signedBalance(account)} size={15} />
      </View>
      {trailing}
    </Pressable>
  );
}
