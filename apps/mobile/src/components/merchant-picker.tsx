import { Check, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Sheet } from '@/components/ui/sheet';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Option = { key: string; name: string; count: number };

/** Pick one merchant to filter by (15e), from the ones in the feed, most frequent first. */
export function MerchantPicker({
  visible,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  options: Option[];
  selected: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  const colors = useTheme();
  const [search, setSearch] = useState('');
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, search]);

  return (
    <Sheet visible={visible} onClose={onClose} avoidKeyboard style={{ height: '75%', paddingTop: Spacing.lg }}>
      <AppText variant="title" style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
        Merchant
      </AppText>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.sm,
          marginHorizontal: Spacing.md,
          marginBottom: Spacing.sm,
          height: 40,
          paddingHorizontal: Spacing.sm + 2,
          borderRadius: Radius.md,
          backgroundColor: colors.elevated,
        }}>
        <Search size={16} color={colors.textDim} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search merchants"
          placeholderTextColor={colors.textDim}
          autoCorrect={false}
          style={{ flex: 1, fontFamily: Type.body, fontSize: 15, color: colors.text, padding: 0 }}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <X size={16} color={colors.textDim} />
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(o) => o.key}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <AppText tone="dim" style={{ padding: Spacing.md }}>
            {options.length === 0 ? 'No merchants loaded yet.' : 'No merchant matches that.'}
          </AppText>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              onSelect(item.key);
              onClose();
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.sm,
              paddingVertical: Spacing.sm + 2,
              paddingHorizontal: Spacing.md,
              backgroundColor: pressed ? colors.elevated : 'transparent',
            })}>
            <AppText variant="label" style={{ flex: 1 }} numberOfLines={1}>
              {item.name}
            </AppText>
            <AppText variant="caption" tone="dim">
              {item.count}
            </AppText>
            {item.key === selected ? <Check size={18} color={colors.brand} /> : <View style={{ width: 18 }} />}
          </Pressable>
        )}
      />
    </Sheet>
  );
}
