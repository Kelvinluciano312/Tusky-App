# Graph Report - Tusky-App  (2026-10-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2120 nodes · 5886 edges · 125 communities (86 shown, 39 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `863368f8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- onboarding.tsx
- server.cjs
- dataUtilities.ts
- ref_react
- useTheme
- presets.ts
- sync.ts
- _shared/recurring.ts
- category-sheet.tsx
- dependencies
- expo
- transaction/[id].tsx
- revenuecat.ts
- (tabs)/index.tsx
- Button
- legacy/package.json
- public.transactions
- rules.ts
- mobile/package.json
- recurring.tsx
- queries.ts
- plaid-exchange-token/index.ts
- lib/two-factor.ts
- legacy/src/App.tsx
- rls-check.mjs
- lib.ts
- ai.ts
- review.tsx
- AppText
- settle.ts
- route
- auth.users
- compilerOptions
- app/_layout.tsx
- dialog.tsx
- plaid-webhook/index.ts
- jev.ts
- public.accounts
- App1.tsx
- Endpoint/index.tsx
- custom-ai.ts
- herd.tsx
- compilerOptions
- 20261006120000_phase12c_crowd_labels.sql
- 20260926130000_phase9b_herds.sql
- settings.tsx
- transaction-filters.ts
- public.categories
- sync.test.ts
- bank/[id].tsx
- compilerOptions
- compilerOptions
- connections.ts
- triage.ts
- merge.test.ts
- _shared/two-factor.ts
- goals.py
- public.transaction_questions
- devDependencies
- public.leave_herd
- plaid-log.ts
- lib/categories.test.ts
- 20261015150000_phase16e2_two_factor_sessions.sql
- devDependencies
- secure-storage.test.ts
- backups/src/components/AppRoutes.tsx
- herd/index.ts
- backups/src/App.tsx
- ref_node_assert
- mobile/tsconfig.json
- helper.js
- dependencies
- Items.tsx
- scripts
- category-source.ts
- 20260928120000_phase9d_who_paid.sql
- plan-banner.test.ts
- stop-server.sh
- dependencies
- split-sheet.tsx
- ref_jsr_std
- devDependencies
- scripts
- scripts
- reportWebVitals.ts
- public.budgets
- public.plaid_events
- (auth)/_layout.tsx
- start-server.sh
- handle_plaid_error
- backups/tsconfig.json
- legacy/tsconfig.json
- af_transactions_answer_questions
- find-polluter.sh
- start.sh script

## God Nodes (most connected - your core abstractions)
1. `AppText()` - 139 edges
2. `useTheme()` - 138 edges
3. `Button()` - 70 edges
4. `react-native` - 70 edges
5. `Spacing` - 59 edges
6. `Card()` - 43 edges
7. `Amount()` - 39 edges
8. `public.transactions` - 37 edges
9. `Radius` - 36 edges
10. `useSession()` - 35 edges

## Surprising Connections (you probably didn't know these)
- `label()` --indirect_call--> `day()`  [INFERRED]
  supabase/functions/_shared/learn.test.ts → apps/mobile/src/lib/calendar.test.ts
- `ok()` --calls--> `jsonResponse()`  [EXTRACTED]
  supabase/functions/plaid-webhook/index.ts → supabase/functions/_shared/lib.ts
- `getKey()` --calls--> `loggable()`  [EXTRACTED]
  supabase/functions/plaid-webhook/index.ts → supabase/functions/_shared/lib.ts
- `syncItem()` --indirect_call--> `askJev()`  [INFERRED]
  supabase/functions/_shared/sync.ts → supabase/functions/_shared/jev.ts
- `transactions_feed_idx` --indexes--> `public.transactions`  [EXTRACTED]
  supabase/migrations/20260926130000_phase9b_herds.sql → supabase/migrations/20260920150000_phase2_transactions.sql

## Import Cycles
- None detected.

## Communities (125 total, 39 thin omitted)

### Community 0 - "onboarding.tsx"
Cohesion: 0.05
Nodes (88): AccountScreen(), BankStep(), BudgetStep(), Heading(), NameStep(), OnboardingScreen(), PlansStep(), Point() (+80 more)

### Community 1 - "server.cjs"
Cohesion: 0.05
Nodes (58): bootstrapPage(), brandMarkup(), broadcast(), browserLauncherForPlatform(), chmodOwnerOnly(), clients, companionUrl(), computeAcceptKey() (+50 more)

### Community 2 - "dataUtilities.ts"
Cohesion: 0.05
Nodes (61): AssetResponseData, assetsCategories, AssetsDataItem, authCategories, AuthDataItem, balanceCategories, BalanceDataItem, checkReportBaseReportCategories (+53 more)

### Community 3 - "ref_react"
Cohesion: 0.14
Nodes (31): JoinInviteScreen(), lastSent, Props, Props, Props, DELETE_WORD, Props, Option (+23 more)

### Community 5 - "useTheme"
Cohesion: 0.12
Nodes (40): BudgetsScreen(), GroupBreakdown(), sectionLabel, TabsLayout(), Legend(), PersonRow(), ReportsScreen(), sectionLabel (+32 more)

### Community 6 - "presets.ts"
Cohesion: 0.07
Nodes (39): CategoriesById, groupIdOf(), activeMonths(), buildPresets(), capped(), estimateIncome(), finish(), HISTORY_MONTHS (+31 more)

### Community 7 - "sync.ts"
Cohesion: 0.09
Nodes (35): AccountRow, buildSnapshotRows(), SnapshotRow, syncAccounts(), amountBand(), BANDS, communityAnswers(), communityCategory() (+27 more)

### Community 8 - "_shared/recurring.ts"
Cohesion: 0.09
Nodes (42): anchorDay(), byStreamKey(), Cadence, cadenceFor(), CADENCES, circularDayDistance(), classifyGroup(), dayNumber() (+34 more)

### Community 9 - "category-sheet.tsx"
Cohesion: 0.10
Nodes (35): CategoriesScreen(), CategoryLine(), KIND_LABEL, sectionLabel, sheetKey(), CategoryPicker(), KIND_LABEL, Props (+27 more)

### Community 10 - "dependencies"
Cohesion: 0.05
Nodes (40): dependencies, expo, expo-build-properties, expo-calendar, expo-constants, expo-dev-client, expo-device, expo-font (+32 more)

### Community 11 - "expo"
Cohesion: 0.05
Nodes (37): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, package, predictiveBackGestureEnabled, usesNonExemptEncryption (+29 more)

### Community 12 - "transaction/[id].tsx"
Cohesion: 0.19
Nodes (31): RulesScreen(), formatDate(), shortDate(), TransactionScreen(), SheetTarget, DetailLine(), NoteSheet(), AskButton() (+23 more)

### Community 13 - "revenuecat.ts"
Cohesion: 0.09
Nodes (30): sameSecret(), adminSubStore(), endOf(), eventUserIds(), forgetRevenueCatUser(), PAID, PaidPlan, PURCHASED (+22 more)

### Community 14 - "(tabs)/index.tsx"
Cohesion: 0.11
Nodes (26): greeting(), HomeScreen(), AccountRow(), Props, Props, Sparkline(), AccountGroup, Balanced (+18 more)

### Community 15 - "Button"
Cohesion: 0.15
Nodes (25): AcceptTermsScreen(), Row(), SignUpScreen(), JoinScreen(), RecordPaymentSheet(), DeleteAccountSheet(), NameSheet(), PasswordChecklist() (+17 more)

### Community 16 - "legacy/package.json"
Cohesion: 0.08
Nodes (30): plaid, react, vite, name, private, type, version, eslint (+22 more)

### Community 17 - "public.transactions"
Cohesion: 0.08
Nodes (21): public.transactions, transactions_account_id_idx, transactions_feed_idx, transactions_item_id_idx, transactions_updated_at, transactions_unreviewed_idx, transactions_unreviewed_idx, public.monthly_person_totals (+13 more)

### Community 18 - "rules.ts"
Cohesion: 0.11
Nodes (24): day(), CategoryMap, CategorySource, ExistingCategory, pickCategory(), resolveCategory(), Resolved, MAPS (+16 more)

### Community 19 - "mobile/package.json"
Cohesion: 0.07
Nodes (27): react, main, name, private, version, eslint-config-expo, expo, expo-build-properties (+19 more)

### Community 20 - "recurring.tsx"
Cohesion: 0.12
Nodes (24): RecurringScreen(), CalendarEventDraft, eventFor(), nextOnOrAfter(), parse(), Stream, today, MerchantRule (+16 more)

### Community 21 - "queries.ts"
Cohesion: 0.07
Nodes (26): formatDate(), SettleScreen(), PlanLimits, CATEGORY_EDIT_KEYS, CategoryPatch, Herd, HerdInvite, InvitePreview (+18 more)

### Community 22 - "plaid-exchange-token/index.ts"
Cohesion: 0.14
Nodes (20): ExchangeBody, LinkedAccount, CHOOSE_DAYS, decide(), EnforceItem, EnforceReport, runEnforcer(), FOUR (+12 more)

### Community 23 - "lib/two-factor.ts"
Cohesion: 0.15
Nodes (23): VerifyScreen(), CodeEntry(), confirmLoginCode(), sendLoginCode(), CODE_LENGTH, codeComplete(), codeFailureMessage(), codeFull() (+15 more)

### Community 24 - "legacy/src/App.tsx"
Cohesion: 0.12
Nodes (14): App(), AppRoutes(), Header(), Navigation(), accounts, fmt(), PageOne(), transactions (+6 more)

### Community 25 - "rls-check.mjs"
Cohesion: 0.11
Nodes (16): linked, WIDTHS, adb(), arg, [cmd, ...rest], keys, nodes(), [arg, joiner, host] (+8 more)

### Community 26 - "lib.ts"
Cohesion: 0.27
Nodes (12): LinkTokenBody, Body, Body, corsHeaders, getAdminClient(), getAuthedUser(), getCallerHerd(), getPlaidClient() (+4 more)

### Community 27 - "ai.ts"
Cohesion: 0.13
Nodes (20): AI_MAX_PER_SYNC, AI_UPDATE_CHUNK, AiAnswer, AiLevel, AiRow, AiVerdict, applyAnswers(), AskFn (+12 more)

### Community 28 - "review.tsx"
Cohesion: 0.16
Nodes (23): CaughtUp(), DeckEdge(), Fling, Progress(), ReviewScreen(), RoundButton(), Stamp(), SwipeCard() (+15 more)

### Community 29 - "AppText"
Cohesion: 0.16
Nodes (22): ActiveChip(), compareByDate(), formatSectionDate(), noMatchMessage(), Open, TransactionsScreen(), MerchantPicker(), RealDataBanner() (+14 more)

### Community 30 - "settle.ts"
Cohesion: 0.17
Nodes (22): useSettleUp(), useSettlements(), useSharedLines(), balances(), benefitShares(), cents(), cleanSplit(), equalShares() (+14 more)

### Community 31 - "route"
Cohesion: 0.14
Nodes (25): cra_check_report(), cra_income_insights(), cra_partner_insights(), create_link_token(), create_link_token_for_payment(), create_user_token(), get_access_token(), get_accounts() (+17 more)

### Community 32 - "auth.users"
Cohesion: 0.13
Nodes (15): on_auth_user_created, profiles_updated_at, public.handle_new_user(), public.profiles, public.herd_members, public.leave_herd(), public.leave_herd(), private.effective_plan() (+7 more)

### Community 33 - "compilerOptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+15 more)

### Community 34 - "app/_layout.tsx"
Cohesion: 0.12
Nodes (19): navThemes, queryClient, RootLayout(), RootNavigator(), identifyPurchaser(), useFirstRun(), shouldClearCache(), SessionContext (+11 more)

### Community 35 - "dialog.tsx"
Cohesion: 0.21
Nodes (20): DialogCard(), DialogHost(), emit(), getSnapshot(), listeners, queue, resolve(), styles (+12 more)

### Community 36 - "plaid-webhook/index.ts"
Cohesion: 0.13
Nodes (16): getKey(), keyCache, missCache, ok(), plaid, classifyWebhook(), PlaidJwk, PlaidWebhookBody (+8 more)

### Community 37 - "jev.ts"
Cohesion: 0.16
Nodes (18): askJev(), AskOpts, asObject(), hasJevKey(), isNumber(), JEV_CLIENT, JEV_MAX_RETRY_WAIT_MS, JEV_MODEL (+10 more)

### Community 38 - "public.accounts"
Cohesion: 0.16
Nodes (17): accounts_item_id_idx, accounts_updated_at, accounts_user_id_idx, plaid_items_updated_at, plaid_items_user_id_idx, public.accounts, public.plaid_items, public.plaid_tokens (+9 more)

### Community 39 - "App1.tsx"
Cohesion: 0.17
Nodes (14): App(), Endpoint(), Header(), Link(), Items(), Products(), QuickstartRoot(), Context (+6 more)

### Community 40 - "Endpoint/index.tsx"
Cohesion: 0.18
Nodes (13): Props, Error(), errorPaths, Props, Identity(), Props, Props, Table() (+5 more)

### Community 41 - "custom-ai.ts"
Cohesion: 0.18
Nodes (17): JEV_CONFIDENCE, applyCustom(), askCustom(), CatRow, CUSTOM_MAX_PER_SYNC, customCacheKey(), CustomPlan, customQuestion() (+9 more)

### Community 42 - "herd.tsx"
Cohesion: 0.23
Nodes (17): HerdScreen(), transferLabel(), CODE_LENGTH, expiresIn(), formatCode(), initials(), inviteMessage(), callHerd() (+9 more)

### Community 43 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleDetection, moduleResolution (+11 more)

### Community 44 - "20261006120000_phase12c_crowd_labels.sql"
Cohesion: 0.14
Nodes (11): ae_transactions_crowd_label, community_labels_merchant, consents_forget_on_delete, consents_one_active, private.consents_forget_on_delete(), private.contribute_crowd_label(), private.label_contributor(), public.community_labels (+3 more)

### Community 45 - "20260926130000_phase9b_herds.sql"
Cohesion: 0.13
Nodes (15): public.recurring_streams, recurring_streams_updated_at, recurring_streams_user_next_idx, accounts_herd_id_idx, category_in_herd, herds_updated_at, plaid_items_herd_id_idx, private.my_account_ids() (+7 more)

### Community 46 - "settings.tsx"
Cohesion: 0.22
Nodes (13): SignInScreen(), Backend, backendLabel(), pickBackend(), pickRevenueCatKey(), backend, isSupabaseConfigured, real (+5 more)

### Community 47 - "transaction-filters.ts"
Cohesion: 0.16
Nodes (14): ActiveChip, activeChips(), Direction, Filters, GroupOf, isFiltered(), matchesFilters(), matchesSearch() (+6 more)

### Community 48 - "public.categories"
Cohesion: 0.16
Nodes (15): public.categories, public.plaid_category_map, categories_enforce_tree, categories_parent_id_idx, categories_user_id_idx, public.categories_enforce_tree(), category_overrides_builtin_only, category_overrides_updated_at (+7 more)

### Community 49 - "sync.test.ts"
Cohesion: 0.12
Nodes (11): AiCategory, answerGas(), Call, CATEGORY_ROWS, fixAndShare(), gasAnswer(), ITEM, judged() (+3 more)

### Community 50 - "bank/[id].tsx"
Cohesion: 0.24
Nodes (16): BankScreen(), connectedOn(), readFunctionError(), BANK_DEPENDENT_KEYS, invalidateBankData(), useConnectBank(), useDisconnectBank(), useSandboxTools() (+8 more)

### Community 51 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 52 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 53 - "connections.ts"
Cohesion: 0.18
Nodes (12): AccountOps, deleteAccount(), DeleteResult, disconnectItem(), DisconnectMode, DisconnectPlan, DisconnectResult, fold() (+4 more)

### Community 54 - "triage.ts"
Cohesion: 0.20
Nodes (12): JevResponse, runTriagePass(), asksSplit(), groupTriage(), PRIORITY_LEVELS, readTriage(), SPLIT_SUGGEST_AT, Triage (+4 more)

### Community 55 - "merge.test.ts"
Cohesion: 0.18
Nodes (14): allRows(), fold(), keyOf(), MergeAccount, mergeReconnected(), MergeRow, pairAccounts(), planMerge() (+6 more)

### Community 56 - "_shared/two-factor.ts"
Cohesion: 0.24
Nodes (14): claimsOfRequest(), claimsOfToken(), hasPasswordMethod(), markableSession(), MAX_WRONG_CODES, MAX_WRONG_CODES_PER_USER, reservedAttempt(), secondStepRequired() (+6 more)

### Community 57 - "goals.py"
Cohesion: 0.31
Nodes (9): cmd_checkpoint(), cmd_create(), cmd_next(), cmd_status(), load(), log(), main(), now() (+1 more)

### Community 58 - "public.transaction_questions"
Cohesion: 0.18
Nodes (13): ai_transaction_questions_requeue, private.question_requeues(), public.shared_lines, public.transaction_questions, transaction_questions_open, transaction_questions_transaction, af_transactions_answer_questions, ah_transactions_reopen_question (+5 more)

### Community 59 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, sass, sass-embedded (+7 more)

### Community 60 - "public.leave_herd"
Cohesion: 0.17
Nodes (7): merchant_rules_updated_at, public.merchant_rules, accounts_private_by_connector, herd_invites_herd_id_idx, public.herd_invites, public.merge_into_herd(), public.leave_herd()

### Community 61 - "plaid-log.ts"
Cohesion: 0.29
Nodes (8): clip(), eventRow(), LINK_EXITS_PER_HOUR, linkExitEvent(), plaidErrorFields(), PlaidEvent, PlaidEventName, recordPlaidEvent()

### Community 62 - "lib/categories.test.ts"
Cohesion: 0.17
Nodes (9): all, byId, card, coffee, food, groceries, income, transfer (+1 more)

### Community 63 - "20261015150000_phase16e2_two_factor_sessions.sql"
Cohesion: 0.24
Nodes (7): private.session_verified(), public.two_factor_failures, public.two_factor_sessions, two_factor_failures_session_idx, two_factor_sessions_user_id_idx, public.take_two_factor_attempt(), two_factor_failures_user_idx

### Community 64 - "devDependencies"
Cohesion: 0.17
Nodes (12): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, @types/react, @types/react-dom (+4 more)

### Community 65 - "secure-storage.test.ts"
Cohesion: 0.29
Nodes (7): CHUNK_SIZE, chunkKey(), createSecureStorage(), KeyValueStore, SecureBackend, split(), bigSession

### Community 66 - "backups/src/components/AppRoutes.tsx"
Cohesion: 0.29
Nodes (6): AppRoutes(), PageOne(), configuration, PageThree(), plaidClient, PageTwo()

### Community 67 - "herd/index.ts"
Cohesion: 0.36
Nodes (8): CODE_LENGTH, describeMembershipError(), formatCode(), generateCode(), HerdRequest, MAX_MEMBERS, normalizeCode(), parseHerdRequest()

### Community 68 - "backups/src/App.tsx"
Cohesion: 0.36
Nodes (4): App(), Header(), Navigation(), @clerk/clerk-react

### Community 69 - "ref_node_assert"
Cohesion: 0.31
Nodes (3): LinkExitBody, LinkExitLike, planLimitMessage()

### Community 70 - "mobile/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, allowImportingTsExtensions, paths, strict, extends, include, @/assets/*, expo/tsconfig.base

### Community 71 - "helper.js"
Cohesion: 0.42
Nodes (7): connect(), nextReconnectDelay(), reloadAfterRecovery(), sessionKey(), setStatus(), showTombstone(), websocketUrl()

### Community 72 - "dependencies"
Cohesion: 0.22
Nodes (9): dependencies, lucide-react, plaid, plaid-threads, react, react-dom, react-plaid-link, react-router-dom (+1 more)

### Community 73 - "Items.tsx"
Cohesion: 0.25
Nodes (6): Props, TypeContainer(), accountsCategories, itemCategories, transformAccountsData(), transformItemData()

### Community 74 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, android, ios, lint, start, test, typecheck, web

### Community 75 - "category-source.ts"
Cohesion: 0.36
Nodes (6): GUESS_HINTS, guessHint(), SET_BY, setBy(), SOURCE_LINE, sourceLine()

### Community 76 - "20260928120000_phase9d_who_paid.sql"
Cohesion: 0.36
Nodes (7): ab_accounts_owner, ab_transactions_paid_by, accounts_owner_reapply, private.is_herd_member(), public.accounts_owner(), public.accounts_owner_reapply(), public.transactions_paid_by()

### Community 77 - "plan-banner.test.ts"
Cohesion: 0.43
Nodes (4): days(), planBanner(), PlanInfo, NOW

### Community 78 - "stop-server.sh"
Cohesion: 0.52
Nodes (6): command_has_server_id(), command_line_for_pid(), is_brainstorm_server(), mark_stopped(), read_expected_server_id(), stop-server.sh script

### Community 80 - "dependencies"
Cohesion: 0.29
Nodes (7): dependencies, @clerk/clerk-react, lucide-react, plaid, react, react-dom, react-router-dom

### Community 81 - "split-sheet.tsx"
Cohesion: 0.60
Nodes (5): asText(), Props, SplitSheet(), withShare(), Sheet()

### Community 82 - "ref_jsr_std"
Cohesion: 0.47
Nodes (3): CategoryRow, planCategoryDelete(), readCategoryId()

### Community 83 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, eslint, eslint-config-expo, @types/react, typescript

### Community 85 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 86 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 89 - "public.budgets"
Cohesion: 0.67
Nodes (3): budgets_updated_at, public.budgets, public.monthly_category_totals

### Community 90 - "public.plaid_events"
Cohesion: 0.83
Nodes (3): plaid_events_created_idx, plaid_events_user_idx, public.plaid_events

## Knowledge Gaps
- **25 isolated node(s):** `RFC-6455`, `plaid`, `react`, `vite`, `plaid` (+20 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 749 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **39 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `day()` connect `rules.ts` to `recurring.tsx`?**
  _High betweenness centrality (0.204) - this node is a cross-community bridge._
- **What connects `RFC-6455`, `plaid`, `react` to the rest of the system?**
  _25 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `onboarding.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.05366300366300366 - nodes in this community are weakly interconnected._
- **Should `server.cjs` be split into smaller, more focused modules?**
  _Cohesion score 0.050921861281826165 - nodes in this community are weakly interconnected._
- **Should `dataUtilities.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05325140809011777 - nodes in this community are weakly interconnected._
- **Should `ref_react` be split into smaller, more focused modules?**
  _Cohesion score 0.13960867265996826 - nodes in this community are weakly interconnected._
- **Should `server.py` be split into smaller, more focused modules?**
  _Cohesion score 0.03278688524590164 - nodes in this community are weakly interconnected._