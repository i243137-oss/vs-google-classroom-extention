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
| 2 | Workspace & File Discovery | ⏳ Not Started |
| 3 | File Selection UI | ⏳ Not Started |
| 4 | Google OAuth Authentication | ⏳ Not Started |
| 5 | Google Classroom — Courses | ⏳ Not Started |
| 6 | Assignment Discovery | ⏳ Not Started |
| 7 | Submission Model | ⏳ Not Started |
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

## ⏭️ Next Step

**Start Phase 1 — VS Code Extension Skeleton**

When resuming:
1. Read this PROGRESS.md file first.
2. The repo currently contains only: `.gitignore`, `README.md`, `PROGRESS.md`, `.git/`
3. Begin by scaffolding the full TypeScript VS Code extension structure as described in Phase 1 of the plan.
4. Key commands to implement (stubs only): `Classroom: Submit Assignment`, `Classroom: Sign In`, `Classroom: Sign Out`
5. Acceptance criteria: compiles, launches in Extension Development Host, commands appear in Command Palette.

---

## 📁 Current File Tree

```
vs-google-classroom-extention/
├── .git/
├── .gitignore          ← Created in Phase 0
├── PROGRESS.md         ← This file
└── README.md
```

---

## 🔧 Developer Notes

- **To resume after session limit:** Read this file, check the Phase Map table, find the first `⏳ Not Started` or `🔄 In Progress` phase, then read the plan MD for that phase's requirements.
- **Plan MD location:** `VS Code Extension — Google Classroom Direct Submission.md` (gitignored — local only)
- **Never commit:** `.env`, `credentials.json`, `token.json`, `*.pem`, `*.key`, `service-account*.json`
- **Branch strategy:** Work on `main` during development; create release branches for Marketplace prep.
