import { dialog } from '@/components/ui/dialog';

import { useCrowdPrompt } from '@/hooks/use-crowd-prompt';
import { type Category, type Transaction, useSetMerchantRule, useSetTransactionCategory } from '@/lib/queries';

type Target = Pick<Transaction, 'id' | 'category_id' | 'category_is_manual' | 'merchant_key'>;

/**
 * Recategorize one transaction, asking "Just this one / Always" when its
 * merchant can take a rule. Shared by the transaction screen and review cards.
 */
export function useCategoryChoice() {
  const setCategory = useSetTransactionCategory();
  const setRule = useSetMerchantRule();
  const noteFix = useCrowdPrompt();

  return (t: Target, name: string, next: Category) => {
    if (next.id === t.category_id) return;
    const once = () =>
      setCategory.mutate({ transactionId: t.id, categoryId: next.id }, { onSuccess: noteFix });
    // A name with no letters has an empty key and can take no rule.
    const merchantKey = t.merchant_key || null;
    if (!merchantKey) {
      once();
      return;
    }
    dialog.alert(
      `Always categorize ${name} as ${next.name}?`,
      "Applies to past and future ones you haven't set by hand.",
      [
        { text: 'Just this one', onPress: once },
        {
          text: 'Always',
          onPress: () => {
            setRule.mutate(
              { merchantKey, categoryId: next.id },
              { onError: (err) => dialog.alert('Could not save', err.message) },
            );
            // The rule skips rows set by hand, and this one may be one.
            if (t.category_is_manual) once();
          },
        },
      ],
      { cancelable: true },
    );
  };
}
