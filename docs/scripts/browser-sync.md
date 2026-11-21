# Browser Sync (`browser-sync`)

**Version:** 1.0.0  
**Category:** Sync  
**Modes:** Chromium/Edge Manifest V3 Extension (`extension/background.js`) and Userscript / Stay (`scripts/browser-sync/browser-sync.user.js`)

## Overview

`Browser Sync` connects multiple browsers and devices (for example, Windows PC Edge, iPhone Safari with Stay, iPad Safari with Stay, mobile Edge, and additional PCs) through your own Supabase Postgres database. Nothing is hardcoded in the script, and all sync data stays under your own Supabase project.

## Capabilities by Environment

| Feature | PC Edge (Unpacked MV3 Extension) | iOS Safari / Mobile Edge (Stay Userscript) |
| :--- | :--- | :--- |
| **Open Tabs** | Full real-time list across all non-incognito windows | Recently active tabs (24h rolling window via `sessionStorage` tab ID) |
| **Tab Groups** | Full read (title, color, collapsed state) + native **Open Group** | View Edge tab groups and open tabs by tap |
| **Recently Closed Tabs** | Live capture via `tabs.onRemoved` + `chrome.sessions` (last 50) | View PC closed tabs |
| **Master History (7d default)** | Pushes every sanitized visit (`history.onVisited`); optional import of remote visits into Edge native history | Pushes every sanitized visit + SPA route changes (`pushState`, `popstate`, `hashchange`) |
| **Usage Time** | Active foreground seconds per domain (`windows.onFocusChanged` + 60s `idle` detection) | Active foreground seconds per domain (`visibilitychange` + 60s interaction window) |
| **Account / Profile Label** | Auto-detects Microsoft Account email (`chrome.identity.getProfileUserInfo`) + manual override | Optional manual label |

## Setup Guide

### 1. Apply the Supabase Schema (One-Time)

Run [supabase-sync-schema.sql](../supabase-sync-schema.sql) in your Supabase project's SQL Editor (or push the migration via Supabase CLI). It creates four locked-down tables (`besing_sync_spaces`, `besing_sync_devices`, `besing_sync_history`, `besing_sync_usage`) with Row Level Security enabled and zero public policies, plus four validated RPC functions.

### 2. Generate Your Sync Link (One-Time)

1. Open BESing on your first browser and click **Browser Sync** -> **Setup**.
2. Under **First-Time Supabase Link Generator**, paste your Supabase Project URL (`https://<ref>.supabase.co`) and your **publishable / anon key** (never the `service_role` key).
3. Click **Generate Secret & Sync Link**. BESing generates a random 32-byte secret locally, computes its SHA-256 hash, fills your `besing-sync://...` Sync Link, and displays a 1-line SQL `INSERT` statement.
4. Run that 1-line SQL `INSERT` once in your Supabase SQL Editor so your database accepts your secret hash.
5. Click **Save & Test**.

### 3. Link Additional Devices (1-Paste)

1. Click **Copy Link** on your first browser.
2. On your other PC, iPhone, or iPad (Safari or Edge), open **BESing** -> **Browser Sync** -> **Setup**, paste the `besing-sync://...` link, set a Device Name, and click **Save & Test**.

### 4. Loading the PC Edge MV3 Extension (Recommended for PC)

To enable full Edge open tabs, tab groups, closed tabs, and Edge account email detection on Windows PC:

1. Open `edge://extensions` in Microsoft Edge.
2. Turn on **Developer mode** (left sidebar).
3. Click **Load unpacked** and select the `BESing/extension` folder.

*(On iPhone/iPad Safari and mobile Edge, continue using `BESing` inside **Stay**, where it automatically runs in userscript mode.)*

## Privacy & Bandwidth Protections

- **Never synced:** Cookies, DOM text, form inputs, incognito/private tabs, non-HTTP(S) URLs (`edge://`, `file://`, `about:`, `javascript:`), URL fragments (`#hash`), tracking parameters (`utm_*`, `fbclid`, `gclid`, etc.), sensitive auth query parameters (`token`, `access_token`, `apikey`, `password`, `session`, `code`, `jwt`, `oauth`, etc.), and any domains you add to **Excluded domains**.
- **Anti-bloat:** Client-side 60-second URL deduplication, server-side 5-minute bucket deduplication, 256 KB max push cap, 500-char URL / 200-char title caps, and automatic hourly pruning past your retention window (default 7 days).
- **Low egress:** Auto-pulls run on open and every 10 minutes (configurable) using delta timestamps (`p_since`) and per-device snapshot hashes (`p_device_hashes`), skipping unchanged tab snapshots.
