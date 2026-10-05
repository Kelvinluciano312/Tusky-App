import { Tabs } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { ArrowLeftRight, ChartPie, House, Settings, Target } from 'lucide-react-native';

import { Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const colors = useTheme();
  // 360dp is five tabs of 72dp: "Transactions" at 11 fits only just, so a hair smaller there.
  const { width } = useWindowDimensions();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textDim,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        // Labels keep their size under a large system font: "Transactions" no longer fits five
        // tabs on a 360dp phone at 130%, and an ellipsis ("Transac...") reads worse than a steady size.
        tabBarAllowFontScaling: false,
        tabBarLabelStyle: {
          fontFamily: Type.bodyMedium,
          fontSize: width < 380 ? 10 : 11,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <House color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          tabBarIcon: ({ color, size }) => <ArrowLeftRight color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: 'Budgets',
          tabBarIcon: ({ color, size }) => <Target color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color, size }) => <ChartPie color={color} size={size} strokeWidth={1.75} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} strokeWidth={1.75} />,
        }}
      />
    </Tabs>
  );
}
