const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Debug ids on the bundle, so a crash can be matched to source once a DSN is set.
// With no DSN the app still builds; Sentry.init is skipped.
module.exports = getSentryExpoConfig(__dirname);
