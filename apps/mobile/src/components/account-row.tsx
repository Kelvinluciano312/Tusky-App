import { View } from 'react-native';

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

export function AccountRow({ account }: { account: Account }) {
  const colors = useTheme();
  const detail = [account.mask ? `···· ${account.mask}` : null, account.subtype ?? account.type]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: Spacing.sm + 2,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}>
      <View style={{ flexShrink: 1, paddingRight: Spacing.sm }}>
        <AppText variant="label">{account.name}</AppText>
        <AppText variant="caption" tone="dim">
          {detail}
        </AppText>
      </View>
      <Amount value={signedBalance(account)} size={15} />
    </View>
  );
}
