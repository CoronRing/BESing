# Quick Transfer (`quick-transfer`)

**Version:** 1.0.0  
**Category:** Sync  
**Backend:** Shared BESing Cloud Database (`public.besing_transfers`)

## Overview

`Quick Transfer` is an open-and-use cross-device drop tool for passing copied text, clipboard screenshots (`Ctrl+V`), or small files between PC, iPhone, and iPad. You do **not** need to enable the script: leaving it OFF adds zero background overhead to pages, and opening its panel works immediately as long as your shared Sync Link is configured in **BESing Settings -> Cloud Database**.

## Features & Limits

- **Text Snippets:** Paste or type any text with an optional name. Short snippets (<= 2 KB) arrive inline in the list so 1-tap **Copy** works synchronously on iOS Safari.
- **Clipboard Images (`Ctrl+V` / Paste Image):** Paste a copied screenshot straight into the text box on PC (or tap **Paste Image**). Large PNG screenshots (> 1.5 MB) are automatically compressed to WebP before upload.
- **File Uploads:** Upload any file up to **5 MB** raw (40 MB total active storage cap per space, max 50 items).
- **Automatic 2-Day Expiry:** Every item expires automatically after 48 hours and is pruned on the next list or upload.
- **Low Bandwidth:** Listing drops fetches metadata only (typically < 1 KB); full images and files are downloaded only when you click **Preview** or **Download**.
