import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Purchases, { PURCHASES_ERROR_CODE, STORE_REPLACEMENT_MODE, type PurchasesPackage } from 'react-native-purchases';

import { type PaidPlan, productChange } from '@/lib/paywall';
import { backend, supabase } from '@/lib/supabase';

/**
 * Buying (Phase 14c). RevenueCat talks to the store; our server decides what
 * a purchase grants. After a purchase or restore the app asks `plan-refresh`
 * to re-read RevenueCat, then refetches the plan. The app never grants access.
 */

// `||` not `??`: unset EXPO_PUBLIC_ vars arrive as empty strings.
const apiKey =
  backend === 'real' ? process.env.EXPO_PUBLIC_PROD_REVENUECAT_KEY || '' : process.env.EXPO_PUBLIC_REVENUECAT_KEY || '';

/** Without a key for this backend there is nothing to buy: the paywall says so. */
export const purchasesEnabled = apiKey !== '';

let configured = false;
/** Settles once RevenueCat knows who is signed in; a purchase waits for it. */
let identified: Promise<void> = Promise.resolve();

/** RevenueCat's user is always the Supabase user, so a purchase can never be anonymous. */
export function identifyPurchaser(userId: string | null): Promise<void> {
  if (!purchasesEnabled) return Promise.resolve();
  identified = (async () => {
    if (!configured) {
      if (!userId) return;
      Purchases.configure({ apiKey, appUserID: userId });
      configured = true;
    } else if (userId) {
      await Purchases.logIn(userId);
    } else {
      await Purchases.logOut().catch(() => {}); // already anonymous
    }
  })().catch((err) => console.warn('RevenueCat identify failed', err));
  return identified;
}

export function useOfferings() {
  return useQuery({
    queryKey: ['offerings'],
    enabled: purchasesEnabled,
    queryFn: async (): Promise<PurchasesPackage[]> => {
      await identified;
      const offerings = await Purchases.getOfferings();
      return offerings.current?.availablePackages ?? [];
    },
  });
}

async function refreshPlan(queryClient: ReturnType<typeof useQueryClient>) {
  const { error } = await supabase.functions.invoke('plan-refresh');
  if (error) console.warn('plan-refresh failed; the webhook will catch up', error);
  await queryClient.invalidateQueries({ queryKey: ['plan'] });
}

export function useBuy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pkg, plan }: { pkg: PurchasesPackage; plan: PaidPlan }): Promise<'bought' | 'cancelled'> => {
      await identified;
      // Play replaces a running plan; Test Store keys (test_…) have no Play subscription to replace.
      const change = apiKey.startsWith('test_')
        ? null
        : productChange((await Purchases.getCustomerInfo()).activeSubscriptions, plan);
      try {
        await Purchases.purchasePackage(
          pkg,
          null,
          change && {
            oldProductIdentifier: change.oldProductIdentifier,
            replacementMode: change.upgrade ? STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION : STORE_REPLACEMENT_MODE.DEFERRED,
          },
        );
      } catch (err) {
        if ((err as { code?: string }).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
        throw err;
      }
      await refreshPlan(queryClient);
      return 'bought';
    },
  });
}

export function useRestore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await identified;
      await Purchases.restorePurchases();
      await refreshPlan(queryClient);
    },
  });
}

/** Cancelling and changing payment happen in the store. */
export async function manageSubscriptionsUrl(): Promise<string> {
  const info = await Purchases.getCustomerInfo().catch(() => null);
  return info?.managementURL || 'https://play.google.com/store/account/subscriptions?package=com.tusky.app';
}
