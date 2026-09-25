/**
 * Merchant display names (Phase 7c). A rename is a merchant rule's
 * display_name, keyed by merchant_key, and applies when data is read: the
 * database keeps Plaid's strings. Pure, so `node --test` runs it.
 */

export type MerchantRule = {
  merchant_key: string;
  category_id: string | null;
  display_name: string | null;
};

export type MerchantRules = Map<string, MerchantRule>;

/** A transaction's name as shown: the user's rename, else Plaid's merchant, else the raw description. */
export function transactionName(
  t: { merchant_key: string | null; merchant_name: string | null; name: string },
  rules: MerchantRules,
): string {
  return (t.merchant_key ? rules.get(t.merchant_key)?.display_name : null) ?? t.merchant_name ?? t.name;
}

/** A recurring stream's name as shown: the user's rename, else the detected name. */
export function streamName(s: { merchant_key: string; name: string }, rules: MerchantRules): string {
  return rules.get(s.merchant_key)?.display_name ?? s.name;
}
