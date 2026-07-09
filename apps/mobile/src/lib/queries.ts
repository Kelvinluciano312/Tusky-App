import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export type Account = {
  id: string;
  item_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string;
  hidden: boolean;
};

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select(
          'id, item_id, name, official_name, mask, type, subtype, current_balance, available_balance, iso_currency_code, hidden',
        )
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export type PlaidItem = {
  id: string;
  institution_id: string | null;
  institution_name: string | null;
  status: string;
};

export function usePlaidItems() {
  return useQuery({
    queryKey: ['plaid_items'],
    queryFn: async (): Promise<PlaidItem[]> => {
      const { data, error } = await supabase
        .from('plaid_items')
        .select('id, institution_id, institution_name, status')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}
