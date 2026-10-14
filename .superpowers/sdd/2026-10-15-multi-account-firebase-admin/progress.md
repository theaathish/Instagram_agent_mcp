# SDD ledger — plan: docs/superpowers/plans/2026-10-15-multi-account-firebase-admin.md

Pre-flight scan:
- Task 1: Deletion of root Python scripts (independent).
- Task 2: Firebase Realtime Database AccountStore (`vercel/lib/firebase.ts`).
- Task 3: Multi-account routing in `vercel/lib/ig.ts`, `vercel/lib/tools.ts`, `vercel/lib/mcp.ts` (consumes AccountStore from Task 2).
- Task 4: Admin API (`vercel/api/admin/accounts.ts`) (consumes AccountStore from Task 2).
- Task 5: Cron refresh (`vercel/api/cron/refresh.ts`) (consumes AccountStore from Task 2).
- Task 6: Admin UI (`vercel/public/admin.html`) (consumes Firebase Client Config & Admin API from Task 4).
- Task 7: Final verification & documentation.
- Pre-flight: No conflicting interfaces found.
