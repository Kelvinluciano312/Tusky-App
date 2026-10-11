// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Files that change without any code changing. Metro sends the app a Fast Refresh
// ("Refreshing...") for every watcher event, so each of these interrupted the app.
// [\\/] matches both separators: this runs on Windows and macOS.
// No regex flags: Metro joins every pattern into one regex and refuses mixed flags.
const noise = [
  /(^|[\\/])\.DS_Store$/, // Finder metadata (macOS)
  /\.icloud$/, // iCloud Drive placeholders
  /(^|[\\/])\.expo[\\/]cache[\\/].*/, // expo lint's cache, among others
  /(^|[\\/])ios[\\/]build[\\/].*/, // codegen and Xcode output
  /(^|[\\/])android[\\/]build[\\/].*/,
  /(^|[\\/])\.metro-health-check.*/,
];

config.resolver.blockList = [].concat(config.resolver.blockList ?? [], noise);

module.exports = config;
