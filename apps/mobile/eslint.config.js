// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Phase 16f: dialogs are app-styled. Use dialog.alert from components/ui/dialog.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Alert'],
              message: "Use dialog.alert from '@/components/ui/dialog' instead of the system Alert.",
            },
          ],
        },
      ],
    },
  },
]);
