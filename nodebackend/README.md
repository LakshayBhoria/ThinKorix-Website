# Thinkorix Backend (Node/Express)

One backend serving all six portals: Internship Portal, Certificate
Verification, Research & Innovation Cell, Idea Submission Portal, Client
Portal, and the Admin Dashboard.

## Quick start

```bash
npm install
npm start        # or: npm run dev  (auto-restarts on file changes)
```

Open **http://localhost:4000** — that's the whole site: landing page, sign
up / log in, and all six portals. A `.env` is already included with safe
local defaults (emails are off, so you don't need SMTP to try everything).
Change `ADMIN_TOKEN` and `JWT_SECRET` before putting this anywhere public.

**First login:** the server seeds one admin account on first boot —
`admin@thinkorix.com` / `change-this-password` (from `.env`). Log in with
that on the site, then use the Admin Dashboard to promote/manage other
accounts. Anyone else can just click "Sign up" on the site and pick a role
(intern, client, contributor, or mentor) — every portal requires being
logged in first.

## What's in `/public`

- `index.html` — landing page; the six module cards link straight into
  the matching portal (login required — logged-out visitors are sent to
  `login.html` first, then back to the page they clicked).
- `login.html` — combined log in / create account screen.
- `portal-internship.html`, `portal-verify.html`, `portal-research.html`,
  `portal-ideas.html`, `portal-client.html`, `portal-admin.html` — the six
  portals. Each one adapts what it shows to the logged-in user's role
  (e.g. an intern sees "My Program"; an admin sees the management table).
- `css/app.css`, `js/api.js` — shared styling and the auth/session helper
  every portal page uses (session storage, API calls, login-gating, the
  top app bar).



## Auth

Every portal shares one login system with roles: `admin`, `mentor`,
`intern`, `client`, `contributor`.

- `POST /api/auth/register` — `{ name, email, password, role }`. Self-signup
  is only allowed for `intern`, `client`, `contributor`, `mentor` — never
  `admin`. Returns `{ user, token }`.
- `POST /api/auth/login` — `{ email, password }` → `{ user, token }`.
- `GET /api/auth/me` — requires `Authorization: Bearer <token>`.

Send the token on every protected request as `Authorization: Bearer <token>`.
Admin-only routes also accept your static `ADMIN_TOKEN` (from `.env`) as
`?token=...` or `Authorization: Bearer <ADMIN_TOKEN>` — a shortcut for
quick admin dashboards/scripts without a full login flow.

Forgot your password? `forgot-password.html` → `POST /api/auth/forgot-password`
`{ email }`, then `reset-password.html` (the link it gives you) →
`POST /api/auth/reset-password` `{ email, token, newPassword }`. With
`SEND_EMAIL=false` (the local default) the reset link is handed straight
back in the response instead of emailed, so this works with zero setup.

## Data storage — local files or Firestore

Every route talks to `src/store.js` (and `src/db.js` for interns
specifically) — never to a database directly. Which backend those use is
one setting:

```
DB_DRIVER=local       # default — JSON files under /data, zero setup
DB_DRIVER=firestore   # your Firebase project
```

**To switch to Firestore:**

1. In the [Firebase Console](https://console.firebase.google.com/), open
   your project → **Project Settings → Service accounts → Generate new
   private key**. This downloads a JSON key file.
2. Save that file inside this project folder — e.g. as
   `firebase-service-account.json` (already in `.gitignore`).
3. In `.env`, set:
   ```
   DB_DRIVER=firestore
   FIREBASE_PROJECT_ID=your-project-id
   GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
   ```
   (On a host without a normal filesystem — e.g. some serverless platforms —
   set `FIREBASE_SERVICE_ACCOUNT_JSON` to the key file's raw contents
   instead of using a file path.)
4. `npm install` (pulls in `firebase-admin`), then `npm start`.

**What moves to Firestore:** structured records only — `users`, `interns`,
`ideas`, `research`, `clientProjects`, `tasks`, `reports`, `attendance`.
**What stays local:** generated offer-letter/certificate PDFs and files
people upload (ideas attachments, client project files/deliverables) —
those continue to live under `/storage` either way, since Firestore isn't
built to hold files and this app already has a place for them. If you
later want those in the cloud too, add Firebase Storage (or S3) uploads in
`src/documentEngine.js` and `src/upload.js` — happy to wire that up on
request.

If `DB_DRIVER=firestore` is set but no credentials are found, the server
fails fast at startup with a clear error telling you what's missing,
rather than silently falling back to local files.

## Internship Portal — `/api/interns`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/register` | public | Registers a candidate; generates + emails Offer Letter and Certificate PDFs |
| GET | `/` | logged in | Admin sees all, mentor sees their assignees, intern sees themself |
| GET | `/admin-list` | admin | Same shape as the old Apps Script admin.html expected |
| POST | `/:internNo/assign-mentor` | admin | `{ mentorId }` |
| POST | `/:internNo/tasks` | admin/mentor | `{ title, description, dueDate }` |
| GET | `/:internNo/tasks` | logged in | |
| PATCH | `/tasks/:taskId` | logged in | `{ status: pending\|in-progress\|done }` |
| POST | `/:internNo/reports` | logged in | `{ type: daily\|weekly, content }` |
| GET | `/:internNo/reports` | logged in | |
| POST | `/:internNo/attendance` | admin/mentor | `{ date, status: present\|absent }` |
| GET | `/:internNo/attendance` | logged in | |
| GET | `/leaderboard` | public | Ranked by tasks completed |
| POST | `/:internNo/resend` | admin | Re-emails existing PDFs |
| POST | `/:internNo/revoke` / `/reinstate` | admin | Toggles certificate validity |
| POST | `/:internNo/regenerate` | admin | Re-renders PDFs from current template coordinates |

## Certificate Verification — `/api/verify`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/:certId` | public | What a scanned QR code hits |
| GET | `/?q=` | admin | Search by partial name/email |

## Research & Innovation Cell — `/api/research`

| Method | Path | Who |
|---|---|---|
| GET | `/?group=&type=` | public |
| GET | `/:id` | public |
| POST | `/` | admin |
| PATCH | `/:id` | admin |
| DELETE | `/:id` | admin |

`type`: `paper` \| `whitepaper` \| `patent` \| `opensource`.
`group`: `AI` \| `Hardware` \| `Software`.

## Idea Submission Portal — `/api/ideas`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/` | public | multipart/form-data: `title, description, submitterName, submitterEmail, submitterType, attachments[]` (up to 5 files) |
| GET | `/mine?email=` | public | A submitter's own ideas |
| GET | `/?status=` | admin | |
| PATCH | `/:id/review` | admin | `{ status: approved\|rejected\|pending, reviewNote }` |

## Client Portal — `/api/client-projects`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/` | client/admin | multipart: `title, requirements, files[]` (up to 10) |
| GET | `/` | logged in | Client sees own, admin sees all |
| GET | `/:id` | logged in | |
| POST | `/:id/milestones` | admin | `{ title, dueDate }` |
| PATCH | `/:id/milestones/:milestoneId` | admin | `{ status }` |
| POST | `/:id/deliverables` | admin | multipart `files[]` — client can then see/download via `GET /:id` |

## Admin Dashboard — `/api/admin`

| Method | Path | Notes |
|---|---|---|
| GET | `/analytics` | Counts across every portal |
| GET | `/users` | List all users (no password hashes) |
| PATCH | `/users/:id/role` | `{ role }` |

## Frontend

`index.html`, `login.html`, `admin.html`, `verify.html`, and any new portal pages
go in `/public` — the server serves them directly (e.g. `http://localhost:4000/`).
Generated PDFs and uploaded files are served from `/storage/offers/...`,
`/storage/certificates/...`, and `/storage/uploads/...`.

**A full frontend is already included** — see "Quick start" below.

## What's deliberately simple (swap out before real production use)

- **File-based storage** — fine for launch, but there's no row-locking
  beyond a naive read-modify-write; a real DB removes that ceiling.
- **Deliverables/uploads are public static files** — anyone with the URL
  can fetch them. If client deliverables must stay private, replace the
  `/storage/uploads` static mount with an authenticated download route.
- **No password reset / email verification flow yet.**
- **No pagination** on list endpoints — fine at hundreds of records, add
  it before you're at thousands.
