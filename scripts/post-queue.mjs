#!/usr/bin/env node
/**
 * Smart Post Agent — Autopilot poster (GitHub Actions)
 *
 * Runs every 30 minutes. Posts due items from queue.json to the Facebook
 * Page, then writes the updated queue back, deletes posted media files,
 * and commits + pushes the changes.
 *
 * Required env vars (GitHub Secrets, never in code):
 *   FB_PAGE_ID      — default Facebook Page ID (Beyond The Silence).
 *                     Queue items may target other Pages via their "page"
 *                     field (Page ID or Page name).
 *   FB_USER_TOKEN   — long-lived USER token (~60 days). Refreshed each run
 *                     via fb_exchange_token, so the stored token only has
 *                     to be a valid long-lived user token. One user token
 *                     covers ALL Pages on the account — no extra secret
 *                     per Page.
 *   FB_APP_ID       — Meta app ID (Smart Post Agent)
 *   FB_APP_SECRET   — Meta app secret
 *   GITHUB_TOKEN    — provided automatically by GitHub Actions (for push)
 *   GITHUB_REPOSITORY — provided automatically (owner/repo)
 *
 * Multi-page: after the token exchange, /me/accounts is called ONCE and a
 * map of all Pages on the account is built (id -> token, name -> id).
 * Each queue item resolves its optional "page" field (Page ID or Page
 * name) against that map; omitted "page" means the default FB_PAGE_ID.
 *
 * Rules:
 * - Never log any token or secret value. Logs contain only counts, item
 *   ids and Facebook post ids.
 * - Exit 0 even if individual queue items fail (one bad item must not
 *   kill the run). Exit non-zero only on total setup failure (missing env
 *   vars, token exchange failure, Page token failure, push failure).
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GRAPH = "https://graph.facebook.com/v27.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE_PATH = path.join(ROOT, "queue.json");
const CONTENT_DIR = path.join(ROOT, "content");

// GitHub enforces a hard 100 MB limit per file in a repo, and the GitHub
// website upload caps at 25 MB per file. Facebook itself allows much
// larger videos, but the repo is the bottleneck, so keep media small.
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

const MIME = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const REQUIRED_ENV = ["FB_PAGE_ID", "FB_USER_TOKEN", "FB_APP_ID", "FB_APP_SECRET"];

function log(msg) {
  console.log(`[post-queue] ${msg}`);
}

function fail(msg) {
  console.error(`[post-queue] FATAL: ${msg}`);
  process.exit(1);
}

// Facebook error messages never contain tokens, but we only ever log the
// message string — never request URLs, bodies, or raw responses.
function safeError(err) {
  return err && err.message ? err.message : String(err);
}

async function graphJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Graph API request failed (HTTP ${res.status})`);
  }
  return data;
}

// Step 1: exchange the stored long-lived user token for a fresh one.
async function exchangeUserToken() {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.FB_APP_ID,
    client_secret: process.env.FB_APP_SECRET,
    fb_exchange_token: process.env.FB_USER_TOKEN,
  });
  const data = await graphJson(`${GRAPH}/oauth/access_token?${params}`);
  if (!data.access_token) throw new Error("Token exchange returned no access token.");
  return data.access_token;
}

// Step 2: list ALL Pages on the account once, and map id -> token and
// name -> entry. One user token covers every Page on the account.
async function getPageMap(userToken) {
  const params = new URLSearchParams({ access_token: userToken, fields: "id,name,access_token", limit: 100 });
  const data = await graphJson(`${GRAPH}/me/accounts?${params}`);
  const byId = new Map();
  const byName = new Map();
  for (const p of data.data || []) {
    if (!p.id || !p.access_token) continue;
    const entry = { id: String(p.id), name: p.name || String(p.id), token: p.access_token };
    byId.set(entry.id, entry);
    byName.set(entry.name.toLowerCase(), entry);
  }
  if (!byId.size) {
    throw new Error("/me/accounts returned no Pages. Check the token and that the Smart Post Agent app is connected to at least one Page.");
  }
  return { byId, byName };
}

// Resolve a queue item's optional "page" field (Page ID or Page name) to a
// Page entry. Omitted "page" means the default FB_PAGE_ID. Returns null
// when the named Page is not on this account.
function resolvePage(item, pageMap) {
  if (!item.page) return pageMap.byId.get(String(process.env.FB_PAGE_ID)) || null;
  const key = String(item.page).trim();
  if (pageMap.byId.has(key)) return pageMap.byId.get(key);
  return pageMap.byName.get(key.toLowerCase()) || null;
}

async function postItem(item, pageToken, pageId) {

  if (item.type === "text") {
    if (!item.caption) throw new Error("Text item has no caption.");
    const data = await graphJson(`${GRAPH}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: item.caption, access_token: pageToken }),
    });
    return data.id;
  }

  if (item.type !== "video" && item.type !== "photo") {
    throw new Error(`Unknown item type: ${item.type}`);
  }
  if (!item.file) throw new Error(`${item.type} item has no file.`);
  const filePath = path.join(ROOT, item.file);
  if (!existsSync(filePath)) throw new Error(`Media file not found in repo: ${item.file}`);
  const size = statSync(filePath).size;
  if (size > MAX_MEDIA_BYTES) {
    throw new Error(
      `Media file ${item.file} is ${(size / 1024 / 1024).toFixed(1)} MB — GitHub rejects files over 100 MB. Use a smaller/compressed file.`
    );
  }

  const ext = path.extname(filePath).toLowerCase();
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("access_token", pageToken);
  form.append("source", new Blob([buf], { type: MIME[ext] || "application/octet-stream" }), path.basename(filePath));
  if (item.type === "video") form.append("description", item.caption || "");
  else form.append("caption", item.caption || "");

  const endpoint = item.type === "video" ? "videos" : "photos";
  const data = await graphJson(`${GRAPH}/${pageId}/${endpoint}`, { method: "POST", body: form });
  return data.id;
}

function git(...args) {
  // stdio pipes only; never log the args (they could contain a token).
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commitAndPush() {
  try {
    git("config", "user.name", "github-actions[bot]");
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
    // Push with the Action token even if the checkout credentials change.
    const repo = process.env.GITHUB_REPOSITORY;
    const ghToken = process.env.GITHUB_TOKEN;
    if (repo && ghToken) {
      git("remote", "set-url", "origin", `https://x-access-token:${ghToken}@github.com/${repo}.git`);
    }
    git("add", "queue.json", "content");
    const status = git("status", "--porcelain").trim();
    if (!status) {
      log("No queue/media changes to commit.");
      return;
    }
    git("commit", "-m", "Post queued items [skip ci]");
    // Push the current branch without relying on an upstream tracking
    // branch being configured (actions/checkout sets one, but be safe).
    git("push", "origin", "HEAD");
    log("Queue + media changes committed and pushed.");
  } catch (err) {
    // The posts already went out; a failed push means the repo still says
    // "queued", so the next run would re-post. Fail loudly so it is seen
    // in the Actions tab instead of silently double-posting later.
    fail(`Could not commit/push queue changes: ${safeError(err)} — check the Actions run; the posted items may need queue.json updated by hand.`);
  }
}

async function main() {
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) fail(`Missing required environment variable: ${name}`);
  }

  let queue;
  try {
    queue = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
    if (!Array.isArray(queue)) throw new Error("queue.json is not an array");
  } catch (err) {
    fail(`Could not read queue.json: ${safeError(err)}`);
  }

  const now = new Date();
  const due = queue.filter(
    (i) => i && i.status === "queued" && i.post_at && !Number.isNaN(new Date(i.post_at)) && new Date(i.post_at) <= now
  );
  log(`Queue: ${queue.length} item(s), ${due.length} due now.`);
  if (!due.length) {
    log("Nothing to post.");
    return;
  }

  let userToken;
  try {
    userToken = await exchangeUserToken();
    log("User token exchanged OK.");
  } catch (err) {
    fail(`Token exchange failed: ${safeError(err)} — the stored FB_USER_TOKEN may be expired; regenerate it with the app's Settings helper and update the repo secret.`);
  }

  let pageMap;
  try {
    pageMap = await getPageMap(userToken);
    log(`Found ${pageMap.byId.size} Page(s) on this account.`);
  } catch (err) {
    fail(`Could not list Pages: ${safeError(err)}`);
  }
  if (!pageMap.byId.has(String(process.env.FB_PAGE_ID))) {
    fail(`Default Page ${process.env.FB_PAGE_ID} (FB_PAGE_ID) not found in /me/accounts. Check FB_PAGE_ID and that the Smart Post Agent app is connected to that Page.`);
  }

  let posted = 0;
  let failed = 0;
  const postedFiles = [];

  for (const item of due) {
    try {
      const target = resolvePage(item, pageMap);
      if (!target) throw new Error("page not found on this account");
      const postId = await postItem(item, target.token, target.id);
      item.status = "posted";
      item.page_post_id = postId;
      delete item.error;
      posted++;
      if (item.file) postedFiles.push(item.file);
      log(`Posted ${item.id} (${item.type}) -> ${target.name} post id ${postId}`);
    } catch (err) {
      item.status = "failed";
      item.error = safeError(err);
      failed++;
      log(`FAILED ${item.id} (${item.type}): ${item.error}`);
    }
  }

  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n", "utf8");

  // Delete media of successfully posted items. Failed items keep their
  // files so they can be retried after fixing queue.json.
  for (const f of postedFiles) {
    try {
      unlinkSync(path.join(ROOT, f));
      log(`Deleted posted media: ${f}`);
    } catch (err) {
      log(`Could not delete ${f}: ${safeError(err)}`);
    }
  }

  commitAndPush();
  log(`Done. Posted: ${posted}, failed: ${failed}.`);
}

main();
