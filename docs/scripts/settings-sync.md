# Settings Sync (`settings-sync`)

**Version:** 1.0.0  
**Category:** Sync  
**Backend:** Shared BESing Cloud Database (`public.besing_script_kv`, namespace `settings`)

## Overview

`Settings Sync` is an optional module (OFF by default) that keeps your BESing configuration aligned across Windows PC Edge, iPhone Safari (Stay), iPad Safari (Stay), and any other linked browser using your shared Sync Link from **BESing Settings -> Cloud Database**.

## Conflict Resolution (UTC Last-Write-Wins)

Every change to a synced setting is stamped with a UTC epoch millisecond timestamp (`Date.now()`). Syncing operates **per logical key**, not as a single overwritten blob:

- `enabled:<scriptId>`: global ON/OFF state per script (excludes `settings-sync` itself so one device cannot accidentally disable sync everywhere).
- `config:<scriptId>`: global configuration for each script (device-local Sync Link and device labels are excluded).
- `site:<hostname>`: per-site rules, blocklist flags, locked script configs, and Ad Cleaner zaps (removals write a 30-day deletion tombstone so offline devices remove the rule cleanly).
- `ui:theme`: desktop pet display theme.

If two devices edit different settings while offline, both edits survive. If two devices edit the same key, the newer UTC timestamp wins automatically. Device-local state (`widgetPos`, `cloudSync`, `boot_log`) is never synced.
