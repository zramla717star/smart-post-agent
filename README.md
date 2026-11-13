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

## Autopilot (GitHub Action — free, full autopilot)

Muse makes the daily content (videos, pictures, captions) and adds it to
the repo; a GitHub Action posts it to the Page automatically. Ramla does
nothing except give content guidelines.

### How it works
- `queue.json` is the posting queue. Each item:
  `{"id": "bts-2026-11-14-0700-ep6", "type": "video", "file": "content/bts-ep6.mp4", "caption": "…", "post_at": "2026-11-14T02:00:00Z", "status": "queued"}`
  - `id` — unique string per item.
  - `type` — `"video"`, `"photo"` or `"text"`.
  - `file` — path in the repo for video/photo (`content/<filename>`);
    omitted for text items.
  - `caption` — the post text.
  - `post_at` — ISO 8601 **UTC** time. PKT is UTC+5, so 7:00 AM PKT =
    `02:00:00Z` the same day.
  - `page` — optional: the target Page, as a Page ID or Page name
    (e.g. `"The Curious Mind"`). Omitted = the default Page
    (`FB_PAGE_ID`, Beyond The Silence). If the named Page is not on the
    account, that item is marked `"failed"` with
    `"page not found on this account"` and the rest still post.
  - `groups` — optional: list of Facebook group names where the post should
    be shared BY HAND after it goes live (e.g. `["ANCIENT HISTORY",
    "Archaeology news & Architecture"]`). Facebook closed the Groups API in
    April 2024, so no app can auto-post into groups — the Queue tab shows
    this list as a reminder. ANCIENT HISTORY bans Page shares/links: share
    there only as a native upload (photo/video straight into the group).
  - `status` — `"queued"`, `"posted"` or `"failed"`. The Action fills in
    `page_post_id` on success and `error` on failure.
- **Multi-page:** one user token covers **all** Pages on her account — no
  extra secret per Page. The Action calls `/me/accounts` once per run and
  posts each item to its own Page. New Pages she creates later work
  automatically once they appear in `/me/accounts` — prerequisite: the new
  Page must have the Smart Post Agent app connected with the same
  permissions (`pages_manage_posts`, `pages_read_engagement`,
  `pages_manage_engagement`).
- `.github/workflows/post-queue.yml` runs every 30 minutes (cron
  `*/30 * * * *`, plus manual run from the Actions tab). It runs
  `scripts/post-queue.mjs` (Node 20, no dependencies): exchanges the
  stored user token for a fresh long-lived one, gets a fresh Page token,
  posts every due item (`post_at` <= now), writes `queue.json` back,
  deletes the media files of posted items, and commits + pushes the
  changes (`Post queued items [skip ci]`). One run at a time (concurrency
  group `post-queue`) so items can't double-post.
- `content/` holds the media files. Keep each file **under 100 MB**
  (GitHub hard limit per file; the GitHub website upload caps at 25 MB
  per file). Posted files are deleted by the Action; failed items keep
  their files so they can be retried (set `status` back to `"queued"`).
- The app's **Queue** tab shows the queue (type, caption preview,
  scheduled time in PKT, status, link to the posted post).

### GitHub Secrets (one-time setup)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value — where it comes from |
|---|---|
| `FB_PAGE_ID` | Graph API Explorer → run `me/accounts` → copy the `id` next to Beyond The Silence |
| `FB_USER_TOKEN` | Long-lived token — generate it in the app: Settings → add App ID + App Secret → **Get Long-Lived Token** → copy the result here. A long-lived **user** token is best (covers ALL Pages on the account). A long-lived **Page** token also works, but only for the default Page (`FB_PAGE_ID`). |
| `FB_APP_ID` | developers.facebook.com → Smart Post Agent → Settings → Basic → App ID |
| `FB_APP_SECRET` | Same page → App Secret (tap Show) |

### Daily plan — 4 posts per day (default slots)
4 queued items per day, possibly across different Pages (use the `page`
field). Default slots, aimed at US Eastern prime time — change any slot
per item via its `post_at` (UTC):

| # | PKT | UTC (`post_at`) | US Eastern |
|---|---|---|---|
| 1 | 5:00 AM | `00:00:00Z` | 7:00 PM EST |
| 2 | 7:30 AM | `02:30:00Z` | 9:30 PM EST |
| 3 | 7:00 PM | `14:00:00Z` | 9:00 AM EST |
| 4 | 10:00 PM | `17:00:00Z` | 12:00 PM EST |

The Action checks every 30 minutes, so an item posts within 30 minutes
of its `post_at` time.

### How Muse adds content
1. Upload the media file to `content/` (browser upload to the repo).
2. Add one entry to `queue.json` with a `post_at` time (UTC) and
   `"status": "queued"` — 4 entries per day at the slots above, with
   `"page"` set when the post is for a Page other than Beyond The Silence.
3. Commit. The Action posts it within 30 minutes of its `post_at` time.

### Maintenance
- `FB_USER_TOKEN` lasts about **60 days**. When the Action starts failing
  with an expired-token error, regenerate it with the app's Settings
  helper (**Get Long-Lived Token**) and update the repo secret. The Action
  exchanges the stored token for a fresh one on every run, so it only
  needs the stored token to still be valid.
- If a run fails on the commit/push step, check the Actions tab — the
  posts may already be out while `queue.json` still says `"queued"`;
  update the queue by hand so the next run doesn't re-post.

## Notes
- Only your own Page. No YouTube, no Groups, no auto-posting to other Pages,
  no automatic replies without approval.
- Scheduled posts in the web app (V1) are text-only and post when the app
  is open at that time. Automatic posting — including video/photo — is done
  by the GitHub Action from `queue.json` (see Autopilot above).
- Facebook Graph API v27.0. Gemini model: `gemini-flash-latest`.
- Videos posted by the Action are regular Page videos (not Reels — the
  Reels endpoint is not available to this app). Use MP4/MOV.
- Never put a token, secret or API key in `queue.json`, a caption, the code
  or a commit message. The Action logs only counts, item ids and post ids.
