# Graph Report - Tusky-App  (2026-10-10)

## Corpus Check
- 385 files · ~348,331 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 23 file(s) not represented in the graph (top: (none) 7, .scss 7, .css 5)

## Summary
- 2082 nodes · 5613 edges · 141 communities (88 shown, 53 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Legacy Plaid Products UI
- Categories & Rules Screens
- Sign-in & Onboarding
- Legacy Backup Web App
- Budget Presets
- Paywall Logic
- Legacy Backup Package
- Recurring Detection
- Mobile Package Manifest
- Budgets & Reports Screens
- Category Picker & Sheets
- Mobile Dependencies
- Expo App Config
- Herds Migration (Phase 9b)
- RevenueCat Webhook
- Herd & Questions UI
- Account & Terms Screens
- Transactions Screen
- Account Deletion & Connections
- Account Sync
- Plaid Edge Functions
- Transaction Detail & Rules
- Categorization Engine
- Bank Screen & Plaid Link
- Data Queries
- Category Quality Script
- AI Categorization
- Legacy Plaid API Endpoints
- Plan Enforcement
- Splits & Settle Math
- Legacy Package
- Legacy App TS Config
- Plaid Webhook Verification
- Jev AI Client
- Settle & Invite Screens
- Recurring Screen
- Review Deck Screen
- Dialog System
- Legacy App Shell
- Two-Factor Code Entry
- Custom Category AI
- Sign-up & Password
- Legacy Backup TS Config
- Legacy Endpoint Components
- Sync Tests
- Crowd Labels Migration
- Legacy Backup Node TS Config
- Legacy Node TS Config
- AI Triage
- Reconnect Account Merge
- Two-Factor Server
- Layout & Plans
- Legacy Dev Dependencies
- Splits & Settlements Migration
- Herd Membership Migration
- Two-Factor Migration
- Backend Environment
- Crowd Categorization
- Who-Paid Migration
- Spent-By Questions Migration
- Crowd Prompt
- Account Grouping & Net Worth
- First-Run Gating
- Secure Storage
- Herd Edge Function
- Plaid Items Migration
- Transactions Migration
- Plans Migration
- Calendar Events
- Net Worth Migration
- Mobile TS Config
- package.json
- dataUtilities.ts
- package.json
- category-icon.tsx
- 20260922180647_phase3_budgets_reports.sql
- 20260924210000_phase7b_custom_categories.sql
- 20260923180000_phase5_recurring_streams.sql
- 20260926120000_phase9a_profiles.sql
- merchants.ts
- 20261012120000_phase15c_terms_onboarding.sql
- 20260924190000_phase7a_category_groups.sql
- 20261015130000_phase16b_review_window.sql
- 20261015140000_phase16e_two_factor.sql
- eslint.config.js
- package.json
- package.json
- categories.ts
- 20260925120000_phase7c_merchant_rules.sql
- 20261016130000_review_advisor_fixes.sql
- 20261017120000_plaid_events.sql
- reportWebVitals.ts
- 20261015160000_phase16e3_attempt_limit.sql
- 20260930120000_phase11a_person_totals.sql
- 20261002120000_phase12a_category_source.sql
- 20261002130000_phase12a_merchant_labels.sql
- 20261013130000_phase15d_questions_resolve.sql
- 20261014130000_phase15h_ai_custom_cache.sql
- 20261016120000_delete_personal_herd.sql
- _layout.tsx
- server.py
- tsconfig.json
- setupProxy.js
- tsconfig.json
- 20260925150000_phase8_transaction_review.sql
- start.sh
- setupTests.ts

## God Nodes (most connected - your core abstractions)
1. `AppText()` - 139 edges
2. `useTheme()` - 138 edges
3. `Button()` - 70 edges
4. `react-native` - 69 edges
5. `Spacing` - 59 edges
6. `Card()` - 43 edges
7. `Amount()` - 39 edges
8. `Radius` - 36 edges
9. `TextField()` - 35 edges
10. `Layout` - 35 edges

## Surprising Connections (you probably didn't know these)
- `label()` --indirect_call--> `day()`  [INFERRED]
  supabase/functions/_shared/learn.test.ts → apps/mobile/src/lib/calendar.test.ts
- `syncItem()` --indirect_call--> `askJev()`  [INFERRED]
  supabase/functions/_shared/sync.ts → supabase/functions/_shared/jev.ts
- `ok()` --calls--> `jsonResponse()`  [EXTRACTED]
  supabase/functions/plaid-webhook/index.ts → supabase/functions/_shared/lib.ts
- `getKey()` --calls--> `loggable()`  [EXTRACTED]
  supabase/functions/plaid-webhook/index.ts → supabase/functions/_shared/lib.ts
- `SignInScreen()` --calls--> `AppText()`  [EXTRACTED]
  apps/mobile/src/app/(auth)/sign-in.tsx → apps/mobile/src/components/ui/app-text.tsx

## Import Cycles
- None detected.

## Communities (141 total, 53 thin omitted)

### Community 1 - "Legacy Plaid Products UI"
Cohesion: 0.05
Nodes (61): AssetResponseData, assetsCategories, AssetsDataItem, authCategories, AuthDataItem, balanceCategories, BalanceDataItem, checkReportBaseReportCategories (+53 more)

### Community 2 - "Categories & Rules Screens"
Cohesion: 0.14
Nodes (30): KIND_LABEL, sectionLabel, lastSent, Props, Props, Props, Props, DELETE_WORD (+22 more)

### Community 3 - "Sign-in & Onboarding"
Cohesion: 0.12
Nodes (45): SignInScreen(), BankStep(), BudgetStep(), Heading(), NameStep(), OnboardingScreen(), PlansStep(), Point() (+37 more)

### Community 4 - "Legacy Backup Web App"
Cohesion: 0.07
Nodes (24): App(), AppRoutes(), Header(), Navigation(), PageOne(), configuration, PageThree(), plaidClient (+16 more)

### Community 5 - "Budget Presets"
Cohesion: 0.07
Nodes (39): CategoriesById, groupIdOf(), activeMonths(), buildPresets(), capped(), estimateIncome(), finish(), HISTORY_MONTHS (+31 more)

### Community 6 - "Paywall Logic"
Cohesion: 0.07
Nodes (36): activePeriod(), afterPurchase(), baseOf(), BOUGHT, deleteWarning(), herdPayer(), offeringsErrorDetail(), ORDER (+28 more)

### Community 7 - "Legacy Backup Package"
Cohesion: 0.04
Nodes (44): dependencies, @clerk/clerk-react, lucide-react, plaid, react, react-dom, react-router-dom, devDependencies (+36 more)

### Community 8 - "Recurring Detection"
Cohesion: 0.09
Nodes (42): anchorDay(), byStreamKey(), Cadence, cadenceFor(), CADENCES, circularDayDistance(), classifyGroup(), dayNumber() (+34 more)

### Community 9 - "Mobile Package Manifest"
Cohesion: 0.06
Nodes (41): eslint, react, react-dom, @types/react, typescript, main, name, private (+33 more)

### Community 10 - "Budgets & Reports Screens"
Cohesion: 0.12
Nodes (34): BudgetsScreen(), GroupBreakdown(), sectionLabel, Legend(), PersonRow(), ReportsScreen(), sectionLabel, Props (+26 more)

### Community 11 - "Category Picker & Sheets"
Cohesion: 0.09
Nodes (36): CategoriesScreen(), sheetKey(), KIND_LABEL, Props, CategorySheet(), Props, budgetsReplacedBy(), buildTree() (+28 more)

### Community 12 - "Mobile Dependencies"
Cohesion: 0.05
Nodes (40): dependencies, expo, expo-build-properties, expo-calendar, expo-constants, expo-dev-client, expo-device, expo-font (+32 more)

### Community 13 - "Expo App Config"
Cohesion: 0.06
Nodes (35): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, predictiveBackGestureEnabled, projectId (+27 more)

### Community 14 - "Herds Migration (Phase 9b)"
Cohesion: 0.10
Nodes (20): aa_fill_herd_id, accounts_herd_id_idx, balance_snapshots_herd_date_idx, categories_herd_id_idx, category_in_herd, herds_updated_at, plaid_items_herd_id_idx, private.my_account_ids() (+12 more)

### Community 15 - "RevenueCat Webhook"
Cohesion: 0.09
Nodes (30): sameSecret(), adminSubStore(), endOf(), eventUserIds(), forgetRevenueCatUser(), PAID, PaidPlan, PURCHASED (+22 more)

### Community 16 - "Herd & Questions UI"
Cohesion: 0.15
Nodes (28): HerdScreen(), JoinScreen(), NameSheet(), AskButton(), AskSheet(), QuestionBanner(), Chips(), dialog (+20 more)

### Community 17 - "Account & Terms Screens"
Cohesion: 0.15
Nodes (27): AcceptTermsScreen(), AccountScreen(), Row(), TabsLayout(), VerifyScreen(), Props, CodeSheet(), DeleteAccountSheet() (+19 more)

### Community 18 - "Transactions Screen"
Cohesion: 0.13
Nodes (27): ActiveChip(), compareByDate(), formatSectionDate(), noMatchMessage(), Open, TransactionsScreen(), TransactionSort, TransactionRow() (+19 more)

### Community 19 - "Account Deletion & Connections"
Cohesion: 0.11
Nodes (21): AccountOps, deleteAccount(), DeleteResult, disconnectItem(), DisconnectMode, DisconnectPlan, DisconnectResult, fold() (+13 more)

### Community 20 - "Account Sync"
Cohesion: 0.12
Nodes (25): AccountRow, buildSnapshotRows(), SnapshotRow, syncAccounts(), CustomVerdict, LEARN, describeError(), ignoredCategoryIds() (+17 more)

### Community 21 - "Plaid Edge Functions"
Cohesion: 0.26
Nodes (14): req(), LinkTokenBody, Body, ExchangeBody, Body, corsHeaders, getAdminClient(), getAuthedUser() (+6 more)

### Community 22 - "Transaction Detail & Rules"
Cohesion: 0.19
Nodes (24): RulesScreen(), formatDate(), shortDate(), TransactionScreen(), CategoryPicker(), SheetTarget, DetailLine(), NoteSheet() (+16 more)

### Community 23 - "Categorization Engine"
Cohesion: 0.13
Nodes (21): CategoryMap, CategorySource, ExistingCategory, pickCategory(), resolveCategory(), Resolved, MAPS, toSignedAmount() (+13 more)

### Community 24 - "Bank Screen & Plaid Link"
Cohesion: 0.14
Nodes (23): BankScreen(), connectedOn(), memberChips(), readFunctionError(), linkExitBody, LinkExitLike, BANK_DEPENDENT_KEYS, invalidateBankData() (+15 more)

### Community 25 - "Data Queries"
Cohesion: 0.10
Nodes (26): callHerd(), CATEGORY_EDIT_KEYS, CategoryPatch, Herd, HerdInvite, InvitePreview, ItemStatus, NetWorthPoint (+18 more)

### Community 26 - "Category Quality Script"
Cohesion: 0.11
Nodes (16): linked, WIDTHS, adb(), arg, [cmd, ...rest], keys, nodes(), [arg, joiner, host] (+8 more)

### Community 27 - "AI Categorization"
Cohesion: 0.13
Nodes (20): AI_MAX_PER_SYNC, AI_UPDATE_CHUNK, AiAnswer, AiCategory, AiLevel, AiVerdict, applyAnswers(), AskFn (+12 more)

### Community 28 - "Legacy Plaid API Endpoints"
Cohesion: 0.14
Nodes (25): cra_check_report(), cra_income_insights(), cra_partner_insights(), create_link_token(), create_link_token_for_payment(), create_user_token(), get_access_token(), get_accounts() (+17 more)

### Community 29 - "Plan Enforcement"
Cohesion: 0.14
Nodes (19): CHOOSE_DAYS, decide(), EnforceItem, EnforceReport, runEnforcer(), FOUR, item(), NOW (+11 more)

### Community 30 - "Splits & Settle Math"
Cohesion: 0.17
Nodes (21): asText(), SplitSheet(), withShare(), balances(), benefitShares(), cents(), cleanSplit(), equalShares() (+13 more)

### Community 31 - "Legacy Package"
Cohesion: 0.08
Nodes (23): eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, lucide-react, plaid, react (+15 more)

### Community 32 - "Legacy App TS Config"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+15 more)

### Community 33 - "Plaid Webhook Verification"
Cohesion: 0.13
Nodes (16): getKey(), keyCache, missCache, ok(), plaid, classifyWebhook(), PlaidJwk, PlaidWebhookBody (+8 more)

### Community 34 - "Jev AI Client"
Cohesion: 0.16
Nodes (18): askJev(), AskOpts, asObject(), hasJevKey(), isNumber(), JEV_CLIENT, JEV_MAX_RETRY_WAIT_MS, JEV_MODEL (+10 more)

### Community 35 - "Settle & Invite Screens"
Cohesion: 0.19
Nodes (19): CategoryLine(), JoinInviteScreen(), formatDate(), RecordPaymentSheet(), SettleScreen(), AccountRow(), MerchantPicker(), RealDataBanner() (+11 more)

### Community 36 - "Recurring Screen"
Cohesion: 0.22
Nodes (19): RecurringScreen(), Props, RecurringRow(), streamName(), RecurringStream, useMerchantRules(), useRecurringStreams(), useSetStreamDismissed() (+11 more)

### Community 37 - "Review Deck Screen"
Cohesion: 0.19
Nodes (19): CaughtUp(), DeckEdge(), Fling, Progress(), ReviewScreen(), RoundButton(), Stamp(), SwipeCard() (+11 more)

### Community 38 - "Dialog System"
Cohesion: 0.22
Nodes (19): DialogCard(), DialogHost(), emit(), getSnapshot(), listeners, queue, resolve(), styles (+11 more)

### Community 39 - "Legacy App Shell"
Cohesion: 0.17
Nodes (14): App(), Endpoint(), Header(), Link(), Items(), Products(), QuickstartRoot(), Context (+6 more)

### Community 40 - "Two-Factor Code Entry"
Cohesion: 0.18
Nodes (18): CodeEntry(), confirmLoginCode(), CODE_LENGTH, codeComplete(), codeFailureMessage(), codeFull(), Listener, listeners (+10 more)

### Community 41 - "Custom Category AI"
Cohesion: 0.18
Nodes (17): JEV_CONFIDENCE, applyCustom(), askCustom(), CatRow, CUSTOM_MAX_PER_SYNC, customCacheKey(), CustomPlan, customQuestion() (+9 more)

### Community 42 - "Sign-up & Password"
Cohesion: 0.28
Nodes (13): SignUpScreen(), PasswordChecklist(), PasswordSheet(), Props, TextField(), PASSWORD_MIN, passwordOk(), PasswordRule (+5 more)

### Community 43 - "Legacy Backup TS Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+11 more)

### Community 44 - "Legacy Endpoint Components"
Cohesion: 0.18
Nodes (12): Props, Error(), errorPaths, Props, Identity(), Props, Props, Table() (+4 more)

### Community 45 - "Sync Tests"
Cohesion: 0.11
Nodes (12): AiRow, loadExistingRows(), answerGas(), Call, CATEGORY_ROWS, fixAndShare(), gasAnswer(), ITEM (+4 more)

### Community 46 - "Crowd Labels Migration"
Cohesion: 0.14
Nodes (10): ae_transactions_crowd_label, community_labels_merchant, consents_forget_on_delete, consents_one_active, private.consents_forget_on_delete(), private.contribute_crowd_label(), private.label_contributor(), public.community_labels (+2 more)

### Community 47 - "Legacy Backup Node TS Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 48 - "Legacy Node TS Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 49 - "AI Triage"
Cohesion: 0.20
Nodes (12): JevResponse, runTriagePass(), asksSplit(), groupTriage(), PRIORITY_LEVELS, readTriage(), SPLIT_SUGGEST_AT, Triage (+4 more)

### Community 50 - "Reconnect Account Merge"
Cohesion: 0.18
Nodes (14): allRows(), fold(), keyOf(), MergeAccount, mergeReconnected(), MergeRow, pairAccounts(), planMerge() (+6 more)

### Community 51 - "Two-Factor Server"
Cohesion: 0.24
Nodes (14): claimsOfRequest(), claimsOfToken(), hasPasswordMethod(), markableSession(), MAX_WRONG_CODES, MAX_WRONG_CODES_PER_USER, reservedAttempt(), secondStepRequired() (+6 more)

### Community 52 - "Layout & Plans"
Cohesion: 0.20
Nodes (7): contentWidth(), isWide(), TABLET_MIN_WIDTH, TWO_COLUMN_MIN_WIDTH, twoColumns(), planLimitMessage(), shouldClearCache()

### Community 53 - "Legacy Dev Dependencies"
Cohesion: 0.13
Nodes (15): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, sass, sass-embedded (+7 more)

### Community 54 - "Splits & Settlements Migration"
Cohesion: 0.18
Nodes (5): ac_transactions_split, public.leave_herd(), public.monthly_person_totals, public.shared_lines, settlements_members

### Community 55 - "Herd Membership Migration"
Cohesion: 0.16
Nodes (4): accounts_private_by_connector, herd_invites_herd_id_idx, public.herd_invites, public.leave_herd()

### Community 56 - "Two-Factor Migration"
Cohesion: 0.21
Nodes (6): private.my_herd_id(), private.session_verified(), public.two_factor_failures, public.two_factor_sessions, two_factor_failures_session_idx, two_factor_sessions_user_id_idx

### Community 57 - "Backend Environment"
Cohesion: 0.21
Nodes (8): Backend, pickBackend(), real, sandbox, sessionStorage, expo-secure-store, react-native-url-polyfill, @supabase/supabase-js

### Community 58 - "Crowd Categorization"
Cohesion: 0.35
Nodes (9): amountBand(), BANDS, communityAnswers(), communityCategory(), CROWD, crowdKey(), crowdMerchants(), directionOf() (+1 more)

### Community 59 - "Who-Paid Migration"
Cohesion: 0.23
Nodes (7): ab_accounts_owner, ab_transactions_paid_by, accounts_owner_reapply, private.is_herd_member(), public.accounts_owner(), public.accounts_owner_reapply(), public.transactions_paid_by()

### Community 60 - "Spent-By Questions Migration"
Cohesion: 0.24
Nodes (6): ai_transaction_questions_requeue, private.question_requeues(), public.shared_lines, public.transaction_questions, transaction_questions_open, transaction_questions_transaction

### Community 61 - "Crowd Prompt"
Cohesion: 0.33
Nodes (8): useCrowdPrompt(), afterFix(), CROWD_PROMPT_AFTER, parsePromptState(), PromptState, useCrowdConsent(), useSetCrowdConsent(), @react-native-async-storage/async-storage

### Community 62 - "Account Grouping & Net Worth"
Cohesion: 0.29
Nodes (8): accountGroup, Balanced, GROUP_LABEL, GROUP_ORDER, groupAccounts(), netWorth(), signedBalance(), Account

### Community 63 - "First-Run Gating"
Cohesion: 0.27
Nodes (9): FirstRunState, Gate, gateFor(), nextStep(), ONBOARDING_STEPS, OnboardingStep, previousStep(), stepLabel() (+1 more)

### Community 64 - "Secure Storage"
Cohesion: 0.29
Nodes (7): CHUNK_SIZE, chunkKey(), createSecureStorage(), KeyValueStore, SecureBackend, split(), bigSession

### Community 65 - "Herd Edge Function"
Cohesion: 0.36
Nodes (8): CODE_LENGTH, describeMembershipError(), formatCode(), generateCode(), HerdRequest, MAX_MEMBERS, normalizeCode(), parseHerdRequest()

### Community 66 - "Plaid Items Migration"
Cohesion: 0.36
Nodes (9): accounts_item_id_idx, accounts_updated_at, accounts_user_id_idx, plaid_items_updated_at, plaid_items_user_id_idx, public.accounts, public.plaid_items, public.plaid_tokens (+1 more)

### Community 67 - "Transactions Migration"
Cohesion: 0.29
Nodes (7): public.categories, public.plaid_category_map, public.transactions, transactions_account_id_idx, transactions_feed_idx, transactions_item_id_idx, transactions_updated_at

### Community 68 - "Plans Migration"
Cohesion: 0.29
Nodes (5): private.effective_plan(), public.plan_for(), public.plans, public.subscriptions, subscriptions_updated_at

### Community 69 - "Calendar Events"
Cohesion: 0.29
Nodes (8): CalendarEventDraft, eventFor(), nextOnOrAfter(), parse(), Stream, day(), today, label()

### Community 70 - "Net Worth Migration"
Cohesion: 0.31
Nodes (3): balance_snapshots_user_date_idx, public.balance_snapshots, public.daily_net_worth

### Community 71 - "Mobile TS Config"
Cohesion: 0.22
Nodes (8): compilerOptions, allowImportingTsExtensions, paths, strict, extends, include, @/assets/*, expo/tsconfig.base

### Community 72 - "package.json"
Cohesion: 0.22
Nodes (9): dependencies, lucide-react, plaid, plaid-threads, react, react-dom, react-plaid-link, react-router-dom (+1 more)

### Community 73 - "dataUtilities.ts"
Cohesion: 0.25
Nodes (6): Props, TypeContainer(), accountsCategories, itemCategories, transformAccountsData(), transformItemData()

### Community 74 - "package.json"
Cohesion: 0.25
Nodes (8): scripts, android, ios, lint, start, test, typecheck, web

### Community 75 - "category-icon.tsx"
Cohesion: 0.32
Nodes (5): Row(), Props, CategoryIcon, Props, Transaction

### Community 76 - "20260922180647_phase3_budgets_reports.sql"
Cohesion: 0.29
Nodes (3): budgets_updated_at, public.budgets, public.monthly_category_totals

### Community 77 - "20260924210000_phase7b_custom_categories.sql"
Cohesion: 0.43
Nodes (5): category_overrides_builtin_only, category_overrides_updated_at, public.category_overrides, public.category_overrides_builtin_only(), public.user_categories

### Community 79 - "20260923180000_phase5_recurring_streams.sql"
Cohesion: 0.38
Nodes (3): public.recurring_streams, recurring_streams_updated_at, recurring_streams_user_next_idx

### Community 80 - "20260926120000_phase9a_profiles.sql"
Cohesion: 0.43
Nodes (4): on_auth_user_created, profiles_updated_at, public.handle_new_user(), public.profiles

### Community 81 - "merchants.ts"
Cohesion: 0.47
Nodes (4): MerchantRule, MerchantRules, rules, validateDisplayName()

### Community 83 - "20260924190000_phase7a_category_groups.sql"
Cohesion: 0.47
Nodes (3): categories_enforce_tree, categories_parent_id_idx, categories_user_id_idx

### Community 84 - "20261015130000_phase16b_review_window.sql"
Cohesion: 0.47
Nodes (3): ag_transactions_clear_auto_reviewed, public.merchant_labels(), public.transactions_clear_auto_reviewed()

### Community 86 - "eslint.config.js"
Cohesion: 0.40
Nodes (3): { defineConfig }, expoConfig, eslint-config-expo

### Community 87 - "package.json"
Cohesion: 0.40
Nodes (5): devDependencies, eslint, eslint-config-expo, @types/react, typescript

### Community 88 - "package.json"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 89 - "categories.ts"
Cohesion: 0.60
Nodes (3): CategoryRow, planCategoryDelete(), readCategoryId()

### Community 91 - "20261016130000_review_advisor_fixes.sql"
Cohesion: 0.60
Nodes (3): transactions_category_id_idx, transactions_paid_by_idx, transactions_user_id_idx

### Community 92 - "20261017120000_plaid_events.sql"
Cohesion: 0.60
Nodes (3): plaid_events_created_idx, plaid_events_user_idx, public.plaid_events

## Knowledge Gaps
- **54 isolated node(s):** `@expo/ui`, `expo`, `expo-build-properties`, `expo-constants`, `expo-dev-client` (+49 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 811 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **53 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `req()` connect `Plaid Edge Functions` to `Herd Edge Function`, `Two-Factor Server`, `Dialog System`?**
  _High betweenness centrality (0.223) - this node is a cross-community bridge._
- **What connects `@expo/ui`, `expo`, `expo-build-properties` to the rest of the system?**
  _54 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Legacy Plaid Flask Server` be split into smaller, more focused modules?**
  _Cohesion score 0.031746031746031744 - nodes in this community are weakly interconnected._
- **Why does `normalizeButtons()` connect `Dialog System` to `Plaid Edge Functions`?**
  _High betweenness centrality (0.182) - this node is a cross-community bridge._
- **Should `Legacy Plaid Products UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05325140809011777 - nodes in this community are weakly interconnected._
- **Why does `@clerk/clerk-react` connect `Legacy Backup Web App` to `Legacy Backup Package`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Should `Categories & Rules Screens` be split into smaller, more focused modules?**
  _Cohesion score 0.1367211131276467 - nodes in this community are weakly interconnected._