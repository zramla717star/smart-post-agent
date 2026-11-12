# Smart Post Agent

A free, simple Facebook Page manager for the **Beyond The Silence** Page.
One file (`index.html`) — no build step, no server, no paid services.

## What it does (V1)
- **Dashboard** — recent posts with likes / comments / shares.
- **Create Post** — photo, video or text post, posted straight to your Page.
- **Generate Caption** — AI caption in the Beyond The Silence style (Gemini, free tier).
- **Comments** — latest comments with an AI-suggested reply. Nothing is sent
  without your **Approve & Send** tap.
- **Schedule** — save text posts for a date/time; post them from the app when due.
- **Settings** — your Gemini API key, Page Access Token and Page ID.

## Your keys stay yours
Keys are stored **only in your browser (localStorage)**. They are never in the
code and are sent only to Google's Gemini API and Facebook's Graph API.
Never paste them in a chat or share them with anyone.

## Run it (free, GitHub Pages)
1. Create a GitHub repo named `smart-post-agent` (Public).
2. Upload `index.html` (and this README) to the repo.
3. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch:
   `main`, folder `/ (root)` → **Save**.
4. Open the Pages link GitHub gives you (e.g.
   `https://YOUR-USERNAME.github.io/smart-post-agent/`).
5. In the app, open **Settings** and paste:
   - Gemini API key (from Google AI Studio — free tier)
   - Page Access Token (from Meta Graph API Explorer → Get Page Access Token;
     it expires after a few hours, so generate a fresh one when it stops working)
   - Page ID (from Graph API Explorer → run `me/accounts`, copy the `id`
     next to your Page name)
6. Tap **Test Connection**, then use Dashboard / Create Post / Comments.

## Notes
- Only your own Page. No YouTube, no Groups, no auto-posting to other Pages,
  no automatic replies without approval.
- Scheduled posts in V1 are text-only and post when the app is open at that
  time. Fully automatic background posting needs a GitHub Actions step later.
- Facebook Graph API v27.0. Gemini model: `gemini-flash-latest`.
