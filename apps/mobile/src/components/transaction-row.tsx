import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { CategoryIcon } from '@/components/ui/category-icon';
import { AppText } from '@/components/ui/app-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { transactionName } from '@/lib/merchants';
import { type Category, type Transaction, useMerchantRules } from '@/lib/queries';

type Props = {
  transaction: Transaction;
  category?: Category;
  onPress: () => void;
};

export function TransactionRow({ transaction, category, onPress }: Props) {
  const colors = useTheme();
  const tint = category?.color ?? colors.textDim;
  // Cached once for the whole list; a rename resolves at read time.
  const { data: rules = new Map() } = useMerchantRules();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm + 2,
        paddingHorizontal: Spacing.md,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
        {transaction.logo_url ? (
          <Image source={{ uri: transaction.logo_url }} style={{ width: 38, height: 38 }} contentFit="cover" />
        ) : (
          <CategoryIcon name={category?.icon} size={18} color={tint} />
        )}
      </View>

      <View style={{ flex: 1, paddingRight: Spacing.sm }}>
        <AppText variant="label" numberOfLines={1}>
          {transactionName(transaction, rules)}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
          <View style={{ width: 7, height: 7, borderRadius: Radius.full, backgroundColor: tint }} />
          <AppText variant="caption" tone="dim" numberOfLines={1}>
            {category?.name ?? 'Uncategorized'}
            {transaction.pending ? ' · Pending' : ''}
          </AppText>
        </View>
      </View>

      <Amount value={transaction.amount} size={15} signColor showPlus />
    </Pressable>
  );
}
