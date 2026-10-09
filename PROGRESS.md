# 📋 VS Code Google Classroom Extension — Build Progress Tracker

> **Purpose:** This file is the single source of truth for build progress.
> When switching models or resuming after a session limit, read this file FIRST
> before doing anything else. It tells you exactly what is done, what is next,
> and where to start.

---

## 🗺️ Quick Phase Map

| Phase | Title | Status |
|-------|-------|--------|
| 0 | Project Discovery & Design | ✅ Complete |
| 1 | VS Code Extension Skeleton | ✅ Complete |
| 2 | Workspace & File Discovery | ✅ Complete |
| 3 | File Selection UI | ✅ Complete |
| 4 | Google OAuth Authentication | ✅ Complete |
| 5 | Google Classroom — Courses | ✅ Complete |
| 6 | Assignment Discovery | ✅ Complete |
| 7 | Submission Model | ✅ Complete |
| 8 | Google Drive File Upload | ⏳ Not Started |
| 9 | Attach Files to Classroom Submission | ⏳ Not Started |
| 10 | Turn In / Submit | ⏳ Not Started |
| 11 | Complete Submission Command | ⏳ Not Started |
| 12 | Validation & Pre-submission Checks | ⏳ Not Started |
| 13 | Settings | ⏳ Not Started |
| 14 | Error Handling | ⏳ Not Started |
| 15 | Unit Testing | ⏳ Not Started |
| 16 | Integration Testing | ⏳ Not Started |
| 17 | Performance | ⏳ Not Started |
| 18 | Accessibility & UX Polish | ⏳ Not Started |
| 19 | Documentation | ⏳ Not Started |
| 20 | Packaging | ⏳ Not Started |
| 21 | Marketplace Readiness | ⏳ Not Started |
| 22 | Final Security Audit | ⏳ Not Started |
| 23 | Final End-to-End Test | ⏳ Not Started |

---

## ✅ Phase 0 — Project Discovery & Design

**Status:** Complete  
**Completed:** 2026-10-08

### Discovery Results

- **Repo state:** Empty git repo (only README.md + plan MD)
- **Package manager:** npm (v10.8.2)
- **Node.js:** v20.20.2
- **VS Code CLI:** v1.136.1 (available at `code`)
- **TypeScript:** Not yet installed (will be added in Phase 1)
- **Test framework:** None yet (will use Mocha + @vscode/test-electron per VS Code standard)
- **Linting:** None yet (will add ESLint + typescript-eslint)
- **Formatting:** Will add Prettier
- **Remote:** https://github.com/i243137-oss/vs-google-classroom-extention.git

### Architecture Decisions

#### Tech Stack
- Language: TypeScript (strict mode)
- Runtime: VS Code Extension Host (Node.js)
- Build: `esbuild` (fast bundling) + `tsc` (type-check only)
- Test: Mocha + @vscode/test-electron + sinon + chai
- Lint: ESLint + typescript-eslint
- Format: Prettier

#### Google APIs
| API | Purpose | Scope |
|-----|---------|-------|
| OAuth 2.0 | User sign-in | openid, email, profile |
| Classroom API | List courses, assignments, submissions | `classroom.courses.readonly`, `classroom.coursework.me.readonly`, `classroom.courseworkmaterials.readonly`, `classroom.student-submissions.me.readonly`, `classroom.student-submissions.students.readonly` |
| Drive API | Upload files | `drive.file` (narrowest possible — only files the extension creates) |

#### Authentication Architecture
- Flow: OAuth 2.0 Authorization Code + PKCE via `vscode.env.openExternal` (loopback redirect on localhost)
- Token storage: `vscode.SecretStorage` (encrypted by VS Code)
- Token refresh: Automatic via stored refresh token before each API call
- Never log: access_token, refresh_token, client_secret, auth codes
- Credentials: Loaded at runtime from `vscode.workspace.getConfiguration` for `clientId` + `clientSecret` (user provides from Google Cloud Console — never committed)

#### File Selection Architecture
- `WorkspaceService` — detects open workspace folder(s)
- `FileScanner` — recursive walk using Node `fs/promises` + `AsyncIterator`
- `FileFilter` — applies default + user-configured exclusion rules
- Default exclusions: `.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `dist`, `build`, `target`, `coverage`, `.next`, `.cache`, `out`, `*.vsix`, `*.tsbuildinfo`
- UI: VS Code `QuickPick` with multi-select + checkboxes

#### Submission Architecture
```
WorkspaceService → FileScanner → FileFilter
                                      ↓
                              FileSelectionUI (QuickPick)
                                      ↓
                            SubmissionValidator
                                      ↓
                              DriveService.upload()
                                      ↓
                         ClassroomService.attachFiles()
                                      ↓
                         ClassroomService.turnIn()
                                      ↓
                              ProgressReporter
```

#### Error Handling Architecture
- Typed error classes: `AuthenticationError`, `ClassroomApiError`, `DriveApiError`, `SubmissionError`, `WorkspaceError`, `ValidationError`, `ConfigurationError`
- All Google API errors are caught, HTTP codes mapped to student-friendly messages
- Sensitive fields stripped from errors before display/logging

#### Security Strategy
- `clientId` + `clientSecret`: Stored in VS Code settings (user enters from their own GCP project) — this is standard for VS Code extensions that require per-user GCP projects
- `access_token` + `refresh_token`: Only in `vscode.SecretStorage`
- No hard-coded credentials anywhere
- `.env` in `.gitignore`
- Git pre-commit hook recommendation: `git-secrets` or `truffleHog`

#### Testing Strategy
- Unit tests: Pure TypeScript, mock all external APIs (sinon stubs)
- Integration tests: @vscode/test-electron with real extension host
- Manual E2E: Documented in `docs/testing.md` (requires test GCP project)

### Known Google API Limitations
1. **Classroom API — Student Submission creation:** Students cannot create new submissions via the API; the submission object is auto-created by Google Classroom when the assignment is assigned. The extension retrieves the existing submission ID and modifies it.
2. **Drive scope `drive.file`:** The extension can only access files it creates. This is intentional and the narrowest safe scope.
3. **OAuth for VS Code extensions:** The recommended flow is Authorization Code + PKCE with a localhost redirect. VS Code's `UriHandler` (or a local HTTP server on a random port) is used for the callback. `vscode.authentication` built-in provider does NOT support Google out of the box, so we implement a custom flow.
4. **Classroom `turnIn` API:** Once turned in, the submission cannot be unturned without the student reclaiming it via the Classroom UI (or `studentSubmissions.reclaim`). The extension will warn users before final submission.

---

## ✅ Phase 2 — Workspace and Project File Discovery

**Status:** Complete  
**Completed:** 2026-10-08

### Summary of Implementation:
- **`FileScanner` (`src/workspace/FileScanner.ts`):**
  - Uses `fs.opendir` for memory-efficient async directory traversal.
  - Skips excluded directories at the top level before descending into subtrees.
  - Emits top-level directories as selectable units (`isDirectory: true`) and nested contents as files.
  - Safe symlink handling (does not follow by default to avoid loops) and maximum directory depth guard (depth 50).
  - Graceful per-entry error handling (permission denied logged without halting scan).
- **`FileFilter` (`src/workspace/FileFilter.ts`):**
  - Glob matching via `minimatch` for patterns like `.env`, `*.log`, `*.vsix`, `*.tsbuildinfo`.
  - Max file size filtering based on configuration (`maxFileSizeMb`).
  - `partition()` method separating files into included and excluded buckets for UI display.
- **`WorkspaceService` (`src/workspace/WorkspaceService.ts`):**
  - Single-root and multi-root workspace detection (QuickPick prompt for multi-root).
  - Throws typed `WorkspaceError` ('NO_WORKSPACE') if no folder is open.
  - Full analysis with `analyzeWorkspace()`, tracking total size and oversized files.
  - Byte formatting helper `formatBytes()`.
- **Integrated Command (`src/commands/submitAssignment.ts`):**
  - Integrates workspace discovery with VS Code `withProgress` notification and cancellation token support.
- **Testing:**
  - 24 comprehensive unit tests in `test/suite/workspace.test.ts` covering directory scanning, recursion, exclusions, size limits, glob matching, and empty workspaces.
  - Lightweight `test/mockVscode.cjs` to enable ultra-fast, robust unit testing without launching full Electron GUI.

---

## ✅ Phase 3 — File Selection UI

**Status:** Complete  
**Completed:** 2026-10-08

### Summary of Implementation:
- **`FileSelectionManager` (`src/ui/FilePicker.ts`):**
  - Converts `WorkspaceAnalysis` into rich `FileQuickPickItem` items with icons (`$(folder)`, `$(file)`), path labels, formatted sizes, and exclusion hints.
  - Automatically pre-selects included files and folders containing included files.
  - Excluded files/folders (such as `.env` or files above size limit) default to unchecked.
  - Resolves selections with directory cascading: toggling a directory unit selects/deselects all underlying child files.
  - Computes complete metrics: total files, formatted size (e.g. `1.8 MB`), excluded count.
  - Deduplicates items when parent directory and individual child files are both selected.
- **`FilePicker` (`src/ui/FilePicker.ts`):**
  - Interactive multi-select `QuickPick` (`canSelectMany: true`) with search matching across labels, descriptions, and details.
  - Modal confirmation dialog displaying live metrics (`Files: 14 | Total size: 1.8 MB | Excluded: 2 files`).
  - Graceful cancellation handling on escape/close.
- **Command Integration (`src/commands/submitAssignment.ts`):**
  - Integrated into the submission command flow right after workspace analysis.
  - Displays summary info notifications and verifies at least one file is selected.
- **Testing:**
  - 6 unit tests in `test/suite/filePicker.test.ts` testing item generation, pre-selection flags, directory cascades, deduplication, empty selections, and confirmation validation.
  - Suite now has **39 tests passing** in < 300ms.

---

## ✅ Phase 4 — Google Cloud / OAuth Authentication

**Status:** Complete  
**Completed:** 2026-10-09

### Summary of Implementation:
- **`GoogleAuthServiceImpl` (`src/auth/GoogleAuthService.ts`):**
  - Full OAuth 2.0 Authorization Code flow with PKCE (RFC 7636).
  - Cryptographically secure `code_verifier` (base64url, 43+ chars) and `code_challenge` (S256).
  - CSRF protection via random 32-character hexadecimal `state` validation.
  - Temporary loopback HTTP server listening on configured redirect port (default `5000`, path `/auth/google/callback`).
  - Seamless browser authorization launch with `vscode.env.openExternal`.
  - Secure token storage using VS Code's encrypted `SecretStorage` (`classroomSubmit.googleAuthTokens`).
  - Strict token secrecy: access tokens, refresh tokens, client secrets, and authorization codes are NEVER logged.
  - Transparent token expiration detection and automatic token refresh via Google's token endpoint.
  - Revocation support on sign out via `https://oauth2.googleapis.com/revoke`.
  - Google user profile retrieval (`getUserInfo`) via Google UserInfo API.
- **Commands & Configuration:**
  - Interactive `classroomSubmit.configureCredentials` command allowing users to securely enter Client ID and Client Secret directly in VS Code.
  - Integrated `signInCommand` with progress notification and credential validation.
  - Updated `signOutCommand` with token revocation and SecretStorage cleanup.
  - Added `classroomSubmit.redirectUri` setting to `package.json`.
- **Documentation:**
  - Complete, step-by-step setup guide created in `docs/google-cloud-setup.md` detailing GCP project creation, API enablement, consent screen configuration, redirect URIs, and scopes.
- **Testing:**
  - 17 unit tests in `test/suite/auth.test.ts` covering PKCE generation, state uniqueness, authorization URL format, SecretStorage persistence, expiry detection, automatic token refresh, revocation cleanup, and configuration validation.
  - Test suite now has **56 passing tests** with 0 failures.

---

## ✅ Phase 5 — Google Classroom Courses

**Status:** Complete  
**Completed:** 2026-10-09

### Summary of Implementation:
- **`ClassroomService` (`src/classroom/ClassroomService.ts`):**
  - Authenticated calls to Google Classroom API (`https://classroom.googleapis.com/v1/courses`).
  - Implements `listCourses(options)` and `getCourse(courseId)`.
  - Pagination: Automatically loops through `nextPageToken` to collect all paginated courses.
  - In-memory caching with 5-minute TTL to reduce redundant API calls, with `forceRefresh` support.
  - Safe state filtering: Defaults to `ACTIVE` courses, handles archived and provisioned courses.
  - Granular error mapping via `friendlyHttpError` (HTTP 401, 403, 404, 500, network failure).
  - Cache invalidation on `signOut`.
- **`CoursePicker` (`src/ui/CoursePicker.ts`):**
  - Interactive VS Code QuickPick displaying course names, section, subject, room, and visual status icons (`$(mortar-board)`, `$(archive)`).
  - Friendly handling for empty course lists with direct link to Google Classroom in browser.
  - Keyboard-friendly search matching across name, section, and subject details.
- **Command Integration (`src/commands/selectCourse.ts`):**
  - Integrated with VS Code notification progress (`withProgress`).
  - Sets `state.selectedCourseId` and resets assignment selection for consistency.
- **Testing:**
  - 12 comprehensive unit tests in `test/suite/courses.test.ts` covering authentication headers, pagination, caching TTL, force-refresh, empty lists, error mappings (403, 404, network error), and QuickPick item formatting.
  - Test suite now has **68 passing tests** with 0 failures.

---

## ✅ Phase 6 — Assignment Discovery

**Status:** Complete  
**Completed:** 2026-10-09

### Summary of Implementation:
- **`ClassroomService` (`src/classroom/ClassroomService.ts`):**
  - Implemented `listCourseWork(courseId, options)` querying `courses/{courseId}/courseWork`.
  - Automatic pagination handling across `nextPageToken`.
  - In-memory caching per course with 5-minute TTL and `forceRefresh` support.
  - Implemented `listStudentSubmissions(courseId, courseWorkId)` querying `courses/{courseId}/courseWork/{courseWorkId}/studentSubmissions?userId=me` to fetch authentic submission states (`NEW`, `CREATED`, `TURNED_IN`, `RETURNED`, `RECLAIMED_BY_STUDENT`).
  - Implemented `listAssignmentsWithSubmissions(courseId)` combining coursework with student submissions in a single cohesive model.
  - Due date & time parsing with `ClassroomService.formatDueDate()` supporting full dates, times, missing dates, and calculating `dueStatus` (`NO_DUE_DATE`, `UPCOMING`, `DUE_TODAY`, `OVERDUE`).
  - Submission status evaluation with `ClassroomService.computeSubmissionStatus()`, properly distinguishing Turned in, Turned in (Late), Returned, Reclaimed, and Missing (Overdue).
- **`AssignmentPicker` (`src/ui/AssignmentPicker.ts`):**
  - Interactive QuickPick displaying assignment title, formatted due date, actual submission status, points, and description snippet.
  - Clear visual indicators (`$(check)`, `$(pass)`, `$(alert)`, `$(circle-large-outline)`).
  - Search matching across title, due date, status, and description.
- **Command Integration (`src/commands/selectAssignment.ts`):**
  - Enforces Course ➔ Assignment hierarchy: prompts to select a course if none is currently selected.
  - Progress reporting via `vscode.window.withProgress`.
  - Updates `state.selectedCourseWorkId` and shows summary notification.
- **Testing:**
  - 10 unit tests in `test/suite/assignments.test.ts` covering coursework retrieval, pagination, caching, submission state correlation, due date formatting, overdue detection, and QuickPick UI formatting.
  - Test suite now has **78 passing tests** with 0 failures.

---

## ✅ Phase 7 — Submission Model

**Status:** Complete  
**Completed:** 2026-10-09

### Summary of Implementation:
- **`AssignmentSubmission` Abstraction (`src/submission/types.ts`):**
  - Modeled Google Classroom's internal student submission architecture accurately.
  - Defined explicit states: `'NEW'`, `'CREATED'`, `'TURNED_IN'`, `'RETURNED'`, `'RECLAIMED_BY_STUDENT'`.
  - Added derived convenience flags: `isSubmitted`, `canSubmit`, `canReclaim`, `isResubmission`.
- **`SubmissionService` (`src/submission/SubmissionService.ts`):**
  - Implemented `getStudentSubmission(courseId, courseworkId)` querying `courses/{courseId}/courseWork/{courseWorkId}/studentSubmissions?userId=me`.
  - Architecture compliance: Locates auto-provisioned student submissions created upon coursework publishing (students cannot manually create new records).
  - Implemented `determineSubmissionState(state, late)`: computes user-facing state labels, descriptions, and action availability.
  - Implemented `reclaimSubmission(courseId, courseworkId, submissionId)` calling the `:reclaim` endpoint for un-submitting `TURNED_IN` work so new files can be attached.
  - Maps API errors cleanly via `friendlyHttpError` and `SubmissionError`.
- **Command Integration (`src/commands/viewStatus.ts`):**
  - Integrated `SubmissionService` into the `classroomSubmit.viewStatus` command.
  - Shows current status, overdue/late indicator, points/grade, and interactive actions.
  - Offers immediate "Reclaim Submission" action with confirmation dialog and progress notification.
  - Provides "Open in Browser" button linking to Google Classroom web interface.
- **Testing:**
  - 11 unit tests in `test/suite/submission.test.ts` verifying state determination, submission query, error guards, HTTP 404 handling, and reclaim requests.
  - Test suite now has **89 passing tests** across 7 test suites with 0 failures.

---

## ⏭️ Next Step

**Start Phase 8 — Google Drive File Upload**

When resuming:
1. Review Phase 8 specifications:
   - Implement `DriveService` for uploading files to student's Google Drive folder.
   - Use Google Drive API v3 multipart upload for small/medium project files and resumable upload for larger files.
   - Support creating or locating dedicated Classroom project folders on Drive.
   - Return uploaded Drive file IDs and web view links.
2. Acceptance criteria:
   - TypeScript compiles cleanly (`npm run typecheck`).
   - Linter passes (`npm run lint`).
   - `npm test` passes.
   - Production bundle builds (`npm run compile:prod`).

---

## 📁 Current File Tree

```
vs-google-classroom-extention/
├── .eslintrc.json
├── .gitignore
├── .prettierrc.json
├── PROGRESS.md
├── esbuild.config.js
├── package.json
├── src/
│   ├── extension.ts
│   ├── auth/
│   │   └── GoogleAuthService.ts
│   ├── classroom/
│   │   ├── ClassroomService.ts
│   │   └── types.ts
│   ├── commands/
│   │   ├── index.ts
│   │   ├── selectAssignment.ts
│   │   ├── selectCourse.ts
│   │   ├── signIn.ts
│   │   ├── signOut.ts
│   │   ├── submitAssignment.ts
│   │   └── viewStatus.ts
│   ├── drive/
│   │   └── DriveService.ts
│   ├── errors/
│   │   └── errors.ts
│   ├── submission/
│   │   ├── SubmissionService.ts
│   │   └── types.ts
│   ├── types/
│   │   └── index.ts
│   ├── ui/
│   │   ├── AssignmentPicker.ts
│   │   ├── CoursePicker.ts
│   │   └── FilePicker.ts
│   ├── utils/
│   │   ├── extensionState.ts
│   │   └── logger.ts
│   └── workspace/
│       ├── FileFilter.ts
│       ├── FileScanner.ts
│       └── WorkspaceService.ts
├── test/
│   ├── mockVscode.cjs
│   ├── runTests.ts
│   └── suite/
│       ├── assignments.test.ts
│       ├── auth.test.ts
│       ├── courses.test.ts
│       ├── extension.test.ts
│       ├── filePicker.test.ts
│       ├── index.ts
│       ├── submission.test.ts
│       └── workspace.test.ts
├── tsconfig.json
└── tsconfig.test.json
```

---

## 🔧 Developer Notes

- **To resume after session limit:** Read this file, check the Phase Map table, find the first `⏳ Not Started` or `🔄 In Progress` phase, then read the plan MD for that phase's requirements.
- **Plan MD location:** `VS Code Extension — Google Classroom Direct Submission.md` (gitignored — local only)
- **Never commit:** `.env`, `credentials.json`, `token.json`, `*.pem`, `*.key`, `service-account*.json`
- **Branch strategy:** Work on `main` during development; create release branches for Marketplace prep.


