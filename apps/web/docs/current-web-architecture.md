# LabelHub Web Current Architecture

Last updated: 2026-06-03

This document describes the current `apps/web` architecture for frontend and backend iteration. It focuses on the current runnable web shell, API integration points, fallback behavior, and the next backend alignment work.

## Scope And Boundaries

The current web layer lives under `apps/web/`.

The web app depends on shared package contracts and schema packages, but it must not modify or reimplement package-level behavior:

- `@labelhub/contracts` provides API and domain types.
- `@labelhub/schema-designer` is used by Owner template configuration.
- `@labelhub/schema-renderer` is used by Labeler and Reviewer rendering.
- The web layer must not reimplement schema traversal, `visibleWhen`, validation, normalization, or diff logic.

Current web implementation still keeps local fallback data so the UI remains usable when backend APIs return `500` or are temporarily unavailable.

## Technology Stack

- React 19
- React Router 6
- Vite 5
- TypeScript
- MSW is present in dependencies, but current integration assumes backend API is available through Vite proxy or same-origin `/api/v1/*`.
- Styling is plain CSS in `apps/web/src/styles.css`.
- Shared UI primitives live in `apps/web/src/ui/`.

## Runtime Entry

Main files:

- `apps/web/src/main.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/routes.tsx`
- `apps/web/src/ui/AppShell.tsx`

`App.tsx` owns the top-level routing and local role session. The home route `/` is the login entry. Role is inferred from path for direct navigation:

- `/owner/*` -> `OWNER`
- `/labeler/*` -> `LABELER`
- `/reviewer/*` -> `REVIEWER`

The login page calls `loginWithCredentials`. If the backend login API is unavailable, the current MVP fallback stores the selected role locally and still enters the corresponding workspace so UI iteration can continue.

## Authentication Model

API file:

- `apps/web/src/api/client.ts`

Login endpoint:

```http
POST /api/v1/auth/login
```

Expected backend response shape is compatible with either:

```json
{ "token": "...", "actor": { "id": "...", "role": "OWNER", "displayName": "..." } }
```

or wrapped:

```json
{ "data": { "token": "...", "actor": { "id": "...", "role": "OWNER" } } }
```

Stored browser keys:

- `labelhub_token`
- `labelhub_role`
- `labelhub_actor` when returned by backend

All API requests use:

```http
Authorization: Bearer <labelhub_token>
```

Mutating requests also send:

```http
Idempotency-Key: <crypto.randomUUID()>
```

## API Client Shape

API functions live in:

- `apps/web/src/api/client.ts`
- `apps/web/src/api/owner.ts`
- `apps/web/src/api/labeler.ts`
- `apps/web/src/api/reviewer.ts`

`client.ts` now unwraps common API envelopes:

```ts
{ data: ... }
```

Feature API files also unwrap common list/detail shapes:

- list responses: arrays, `{ items }`, `{ tasks }`, `{ submissions }`, `{ jobs }`, `{ exportJobs }`
- detail responses: direct object, `{ task }`, `{ schema }`, `{ context }`, `{ detail }`, `{ submission }`

This keeps the UI tolerant while the backend response envelope is finalized.

## Route Table

### Home

| Path | Page |
| --- | --- |
| `/` | Login page |

### Owner

| Path | Component | Purpose |
| --- | --- | --- |
| `/owner/tasks` | `OwnerWorkspace` | Task management |
| `/owner/tasks/new` | `OwnerNewTaskPage` | Create task |
| `/owner/tasks/:taskId` | `OwnerTaskDetailPage` | Task detail |
| `/owner/tasks/:taskId/designer` | `OwnerSchemaPage` | Template builder / schema designer |
| `/owner/tasks/:taskId/ai-config` | `OwnerAIPage` | AI pre-review rule settings |
| `/owner/tasks/:taskId/export` | `OwnerExportPage` | Export center |

### Labeler

| Path | Component | Purpose |
| --- | --- | --- |
| `/labeler/tasks` | `LabelerWorkspace` | Task marketplace |
| `/labeler/workspace/:assignmentId` | `AssignmentPage` | Labeling workspace |
| `/labeler/submissions` | placeholder | My submissions |

### Reviewer

| Path | Component | Purpose |
| --- | --- | --- |
| `/reviewer/items` | `ReviewerWorkspace` | AI pre-review queue |
| `/reviewer/items/:submissionId` | `ReviewDetailPage` | Human review detail |
| `/reviewer/submissions/:submissionId` | `ReviewDetailPage` | Legacy compatibility route |

## App Shell

`AppShell` provides:

- Left sidebar navigation
- Current workspace context
- Account switch action
- Main content layout

The current shell still has role-specific sidebar labels. The requested target direction is a more product-like fixed top bar with:

- LabelHub logo
- Workspace breadcrumb
- Logged-in user avatar/name/role
- Global account switch

This is partly implemented visually in some pages, but not yet fully unified across all role shells.

## Owner Domain

Directory:

- `apps/web/src/features/owner/`

API file:

- `apps/web/src/api/owner.ts`

### Task Management

Component:

- `OwnerWorkspace.tsx`

Primary API:

```http
GET /api/v1/tasks
```

Fallback:

- `apps/web/src/mocks/data/tasks.mock.ts`
- `apps/web/src/mocks/local-task-store.ts`

Current behavior:

- Lists tasks from backend when available.
- Falls back to local tasks when API fails.
- Opens selected task details in a floating side panel.
- Row action buttons navigate to:
  - view: `/owner/tasks/:taskId`
  - template: `/owner/tasks/:taskId/designer`
  - export: `/owner/tasks/:taskId/export`

### New Task

Component:

- `OwnerNewTaskPage.tsx`

Primary API:

```http
POST /api/v1/tasks
```

Current behavior:

- Creates task through backend when available.
- Falls back to local task store for UI demo.
- Publish action should confirm through `ConfirmDialog` and then transition to template setup or task list depending product decision.

### Template Builder

Component:

- `OwnerSchemaPage.tsx`

Primary APIs:

```http
GET /api/v1/schema/component-registry
GET /api/v1/tasks/:taskId
GET /api/v1/tasks/:taskId/schema/draft
PUT /api/v1/tasks/:taskId/schema/draft
POST /api/v1/tasks/:taskId/schema/publish
POST /api/v1/tasks/:taskId/publish
```

Schema packages:

- `SchemaDesigner` from `@labelhub/schema-designer`
- `collectFieldNodes`, `createDefaultNode`, `flattenNodes` from `@labelhub/schema-core`

Current behavior:

- Loads server component registry if available.
- Falls back to local component registry.
- Loads task and schema draft by `taskId`.
- Allows loading local preset templates.
- Saves schema draft through backend when available.
- Publishes through backend sequence when available:
  1. save schema draft
  2. publish schema
  3. publish task
- If backend is unavailable, it keeps a local demo publish flow.

Current important product state:

- Preset templates do not change task ownership. If user is editing Task A and loads another preset, Task A remains the bound task; only the schema template content changes.
- Local preset library lives in `OwnerSchemaPage` support files:
  - `localComponentRegistry.ts`
  - `schemaPresetLibrary.ts`

### AI Pre-review Config

Component:

- `OwnerAIPage.tsx`

Current purpose:

- Provides a UI entry for AI pre-review settings.
- Backend contract should align around task-scoped AI rules.

Recommended backend direction:

```http
GET /api/v1/tasks/:taskId/ai-rules
PUT /api/v1/tasks/:taskId/ai-rules
POST /api/v1/tasks/:taskId/ai-rules/test
```

If these endpoints differ in integration branch, web should adapt inside `apps/web/src/api/owner.ts` rather than calling `fetch` directly in components.

### Export Center

Component:

- `OwnerExportPage.tsx`

Primary APIs:

```http
GET /api/v1/tasks/:taskId/exports
POST /api/v1/tasks/:taskId/exports
```

Current export UI supports:

- JSON
- JSONL
- CSV
- Excel
- field selection
- field aliasing
- include review records toggle
- async export history

Current API behavior:

- Loads backend export jobs when available.
- Creates backend export job when available.
- Falls back to local async progress if backend fails.

Current export mapping sent to backend:

```ts
{
  mapping: {
    schemaVersionId,
    format,
    answerSource: "PATCHED_ANSWERS",
    allowPatchedAnswers: true,
    includeReviewRecords,
    columns: [
      { header, sourcePath }
    ],
    filters: {
      acceptedOnly,
      submissionStatus
    }
  }
}
```

## Labeler Domain

Directory:

- `apps/web/src/features/labeler/`

API file:

- `apps/web/src/api/labeler.ts`

### Task Marketplace

Component:

- `LabelerWorkspace.tsx`

Primary APIs:

```http
GET /api/v1/marketplace/tasks
POST /api/v1/tasks/:taskId/claim
```

Current behavior:

- Loads marketplace tasks from backend when available.
- Falls back to local task data if backend fails.
- Claiming a task uses backend when available.
- Falls back to local assignment route when backend fails.

Expected claim response:

```ts
{
  context: AssignmentContextResponse,
  auditLog: ...
}
```

The workspace route should navigate to:

```text
/labeler/workspace/:assignmentId
```

### Labeling Workspace

Component:

- `AssignmentPage.tsx`

Primary APIs:

```http
GET /api/v1/assignments/:assignmentId
GET /api/v1/assignments/:assignmentId/items
PUT /api/v1/assignments/:assignmentId/draft
POST /api/v1/assignments/:assignmentId/submit
POST /api/v1/assignments/:assignmentId/llm-assist
```

Schema package:

- `SchemaRenderer` from `@labelhub/schema-renderer`

Current behavior:

- Loads assignment context from backend when available.
- Attempts to load item navigation list from backend.
- Falls back to local dataset items when item list API fails.
- Uses `SchemaRenderer` for the actual labeling form.
- Saves draft through backend.
- Submit calls backend first, then falls back to local demo submission.
- After submitting one item, the page advances to the next item. It does not jump to Reviewer.

Important backend alignment gap:

- The web currently expects a task/assignment item navigation endpoint.
- If the canonical backend route is not `GET /api/v1/assignments/:assignmentId/items`, update `apps/web/src/api/labeler.ts`.
- The response should provide enough data for the left item navigation:
  - item id
  - source payload title/name
  - status
  - current item marker or ordering

Recommended response:

```ts
{
  items: DatasetItem[],
  total: number,
  currentIndex: number
}
```

## Reviewer Domain

Directory:

- `apps/web/src/features/reviewer/`

API file:

- `apps/web/src/api/reviewer.ts`

### AI Pre-review Queue

Component:

- `ReviewerWorkspace.tsx`

Primary API:

```http
GET /api/v1/review/queue
```

Current query params:

```text
?status=NEEDS_HUMAN_REVIEW
?status=ACCEPTED
?status=RETURNED
```

Current behavior:

- Loads queue from backend when available.
- Uses tab status to request backend-filtered queue.
- Falls back to local review queue when backend fails.
- Selecting a queue item updates the right detail panel in-place.
- Detail content is normalized through `review-display.ts` so list item and opened content stay consistent in local mode.

Current UI represents AI pre-review as one section of Review and Quality Control.

### Human Review Detail

Component:

- `ReviewDetailPage.tsx`

Primary APIs:

```http
GET /api/v1/review/submissions/:submissionId
POST /api/v1/review/submissions/:submissionId/claim
POST /api/v1/review/submissions/:submissionId/decision
POST /api/v1/review/batch-decision
```

Current behavior:

- Opens submission by id.
- Shows human review detail.
- Approve / return actions call `decideReview` when available.
- Local fallback keeps demo status transitions working.

Known product issue:

- AI pre-review queue and human review detail need clearer separation in navigation and layout:
  - AI pre-review queue / settings
  - Human review queue / detail

Suggested route model:

```text
/reviewer/ai-queue
/reviewer/items
/reviewer/items/:submissionId
```

or keep current `/reviewer/items` as AI pre-review list and make the detail route a clear human review page.

## Local Fallback Layer

Local demo/fallback data exists under:

- `apps/web/src/mocks/`
- `apps/web/src/mocks/data/`
- `apps/web/src/mocks/local-task-store.ts`

The fallback layer is intentionally web-only and should be removed or narrowed once backend APIs are stable.

Fallback is currently used when:

- backend returns `500`
- backend is unavailable
- item navigation endpoint is missing
- schema registry or schema draft endpoint fails

Fallback should not be used to hide real contract mismatches indefinitely. When a backend endpoint exists but response shape differs, update the corresponding `apps/web/src/api/*.ts` adapter.

## Current Backend Endpoint Checklist

### Auth

- `POST /api/v1/auth/login`

### Owner

- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `GET /api/v1/schema/component-registry`
- `GET /api/v1/tasks/:taskId/schema/draft`
- `PUT /api/v1/tasks/:taskId/schema/draft`
- `POST /api/v1/tasks/:taskId/schema/publish`
- `POST /api/v1/tasks/:taskId/publish`
- `GET /api/v1/tasks/:taskId/exports`
- `POST /api/v1/tasks/:taskId/exports`

### Labeler

- `GET /api/v1/marketplace/tasks`
- `POST /api/v1/tasks/:taskId/claim`
- `GET /api/v1/assignments/:assignmentId`
- `GET /api/v1/assignments/:assignmentId/items`
- `PUT /api/v1/assignments/:assignmentId/draft`
- `POST /api/v1/assignments/:assignmentId/submit`
- `POST /api/v1/assignments/:assignmentId/llm-assist`
- `GET /api/v1/me/submissions`

### Reviewer

- `GET /api/v1/review/queue`
- `GET /api/v1/review/submissions/:submissionId`
- `POST /api/v1/review/submissions/:submissionId/claim`
- `POST /api/v1/review/submissions/:submissionId/decision`
- `POST /api/v1/review/batch-decision`

## Current Integration Risks

1. Encoding artifacts exist in some source strings.
   Some files contain mojibake text from earlier edits. UI can still render many strings because browser/source encoding may differ, but this should be cleaned in a focused pass.

2. Response envelopes are still defensive.
   The web accepts several shapes. Backend should settle on one consistent envelope. Recommended:

   ```json
   { "data": ..., "requestId": "..." }
   ```

3. Assignment item navigation needs canonical backend support.
   Labeler workspace needs real item order, status, and current item progress.

4. AI pre-review and human review should be split more clearly.
   Current Reviewer queue has both AI pre-review and manual review behaviors in one flow.

5. Export download URL / file retrieval is not fully integrated.
   Web can create/list export jobs and generate local download fallback. Backend should expose file download metadata or a signed download endpoint.

6. Schema publish response needs a stable schema version id.
   Web currently tries `schemaVersion.id` and falls back to local `schema.schemaVersionId`.

## Recommended Backend-Web Contract Shape

Use a consistent envelope:

```ts
interface ApiSuccess<T> {
  data: T;
  requestId?: string;
}

interface ApiFailure {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}
```

Example:

```json
{
  "data": {
    "tasks": [],
    "total": 0,
    "page": 1,
    "pageSize": 20
  },
  "requestId": "req_..."
}
```

## Development Rules For Further Iteration

- Do not call `fetch` directly in feature components. Add or update functions in `apps/web/src/api/*`.
- Keep backend-specific response normalization inside API adapters.
- Keep UI fallback explicit and visible when backend is offline.
- Do not import backend internals into `apps/web`.
- Do not reimplement schema package logic in page components.
- Any route that is not complete should render a clear placeholder, not redirect to `/`.

## Suggested Next Iteration Order

1. Confirm backend response envelope and update API adapters to one final shape.
2. Finalize login seed accounts and remove fallback login when backend auth is stable.
3. Align Labeler item navigation endpoint.
4. Split Reviewer AI pre-review queue and Human review detail into clearer product routes.
5. Complete export download history with real file download endpoint.
6. Clean remaining mojibake strings in `apps/web`.
7. Add a small smoke test checklist for the 16-step E2E flow from web UI.

