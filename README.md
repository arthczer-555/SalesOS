# SalesOS — Coachello Sales Intelligence

Internal tool for the Coachello sales team. Connects to HubSpot, Slack, and Gmail to give sales reps an AI-powered assistant and email composer.

---

## What it does

- **Coachello Intelligence** — AI chat agent (Claude) with real-time access to HubSpot CRM and Slack. Answers questions about deals, contacts, pipeline, and company news. Can send Slack messages.
- **Prospection** — Gmail email composer with To/CC/BCC, attachments, send & save-as-draft.
- **Settings** — Per-user integrations: Claude API key (admin-managed), Gmail OAuth, HubSpot (shared), Slack (shared).
- **Admin panel** — User management, Claude API key assignment, token/cost usage per user (monthly + total).
- **Prompt guide** — Each user can customize the AI system prompt from `/prompt`.

---

## Stack

- **Framework**: Next.js 15 App Router
- **Auth**: Clerk (Google OAuth)
- **Database**: Supabase (Postgres)
- **AI**: Anthropic Claude (Haiku / Sonnet / Opus)
- **Hosting**: Netlify

---

## Integrations

| Service | Type | Auth |
|---------|------|------|
| HubSpot | CRM read | Shared API key (env var) |
| Slack | Read + write | Shared bot token (env var) |
| Gmail | Send + draft | Per-user OAuth (refresh token in DB) |
| Claude | AI | Per-user API key (encrypted in DB) |

---

## Project structure

```
app/
  page.tsx              # AI chat (Coachello Intelligence)
  prospecting/          # Gmail composer
  prompt/               # System prompt editor
  settings/             # User integrations
  admin/                # Admin: users + API keys + usage
  api/
    chat/               # Streaming AI agent endpoint
    gmail/              # Gmail OAuth + send + draft
    prompt/             # Get/save system prompt
    admin/              # Admin API routes
    user/               # Current user info

lib/
  auth.ts               # getAuthenticatedUser() via Clerk + Supabase
  db.ts                 # Supabase client (service role)
  crypto.ts             # AES-256-GCM encrypt/decrypt
  gmail.ts              # Gmail access token refresh + MIME builder

components/
  sidebar.tsx           # Navigation
  coming-soon.tsx       # Placeholder for future pages

middleware.ts           # Clerk auth middleware
prompt-guide.txt        # Default AI system prompt
```

---

## Environment variables

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Encryption (AES-256 key as 64 hex chars)
ENCRYPTION_SECRET=

# Anthropic (fallback — real keys are per-user in DB)
ANTHROPIC_API_KEY=

# HubSpot
HUBSPOT_ACCESS_TOKEN=

# Slack
SLACK_BOT_TOKEN=

# Gmail OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXT_PUBLIC_APP_URL=
```

---

## Supabase schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  user_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(user_id, service)
);

CREATE TABLE user_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_refresh TEXT,
  refresh_iv TEXT,
  refresh_auth_tag TEXT,
  access_token TEXT,
  token_expiry TIMESTAMPTZ,
  connected BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, provider)
);

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Run locally

```bash
npm install
npm run dev
```

*Coachello · Internal · 2026 · Confidential*
