import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Purchases, { PURCHASES_ERROR_CODE, STORE_REPLACEMENT_MODE, type PurchasesPackage } from 'react-native-purchases';

import { type PaidPlan, type Period, productChange } from '@/lib/paywall';
import { ensurePurchaser } from '@/lib/purchaser';
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
/** The Supabase user RevenueCat should be on. */
let expectedUser: string | null = null;
/** Settles once RevenueCat knows who is signed in; a purchase waits for it. Calls run in order. */
let identified: Promise<void> = Promise.resolve();

/** RevenueCat's user is always the Supabase user, so a purchase can never be anonymous. */
export function identifyPurchaser(userId: string | null): Promise<void> {
  if (!purchasesEnabled) return Promise.resolve();
  expectedUser = userId;
  identified = identified.then(async () => {
    if (!configured) {
      if (!userId) return;
      Purchases.configure({ apiKey, appUserID: userId });
      configured = true;
    } else if (userId) {
      await Purchases.logIn(userId);
    } else {
      await Purchases.logOut().catch(() => {}); // already anonymous
    }
  }).catch((err) => console.warn('RevenueCat identify failed', err));
  return identified;
}

/** Buy or restore only as the signed-in user; a failed identify is retried here, or refused. */
async function readyToBuy() {
  await identified;
  await ensurePurchaser(expectedUser, {
    current: () => Purchases.getAppUserID(),
    logIn: (id) => Purchases.logIn(id),
  });
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

/**
 * Ask the server to re-read RevenueCat, then refetch the plan. Unconfirmed
 * (a failed call, the cooldown, or a webhook still on its way): refetch twice
 * more, so the plan appears without a reload.
 */
async function refreshPlan(queryClient: ReturnType<typeof useQueryClient>): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('plan-refresh');
  const confirmed = !error && (data?.result === 'written' || data?.result === 'unchanged');
  await queryClient.invalidateQueries({ queryKey: ['plan'] });
  void queryClient.invalidateQueries({ queryKey: ['purchases', 'active'] });
  if (!confirmed) {
    for (const ms of [15_000, 60_000]) setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['plan'] }), ms);
  }
  return confirmed;
}

/** My running store products (`tusk:monthly` …), for the paywall's period switch. Display only. */
export function useActiveProducts() {
  return useQuery({
    queryKey: ['purchases', 'active'],
    enabled: purchasesEnabled,
    queryFn: async (): Promise<string[]> => {
      await identified;
      return (await Purchases.getCustomerInfo()).activeSubscriptions;
    },
  });
}

export function useBuy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pkg,
      plan,
      period,
    }: {
      pkg: PurchasesPackage;
      plan: PaidPlan;
      period: Period;
    }): Promise<{ outcome: 'bought' | 'deferred' | 'cancelled'; confirmed: boolean }> => {
      await readyToBuy();
      // Play replaces a running plan; Test Store keys (test_…) have no Play subscription to replace.
      const change = apiKey.startsWith('test_')
        ? null
        : productChange((await Purchases.getCustomerInfo()).activeSubscriptions, plan, period);
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
        if ((err as { code?: string }).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
          return { outcome: 'cancelled', confirmed: true };
        }
        throw err;
      }
      const confirmed = await refreshPlan(queryClient);
      return { outcome: change && !change.upgrade ? 'deferred' : 'bought', confirmed };
    },
  });
}

export function useRestore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await readyToBuy();
      await Purchases.restorePurchases();
      await refreshPlan(queryClient);
    },
  });
}

/** Cancelling and changing payment happen in the store. */
export async function manageSubscriptionsUrl(): Promise<string> {
  const info = await Purchases.getCustomerInfo().catch(() => null);
  return info?.managementURL || 'https://play.google.com/store/account/subscriptions?package=com.ouroborosstudios.tusky';
}
