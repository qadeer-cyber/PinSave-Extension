# Affiliate Pin Saver — Chrome Extension

Save Amazon affiliate product pins to Pinterest directly from Facebook group posts — with your Associate tag applied and a clean affiliate URL as the Pinterest destination.

---

## What It Does

Affiliate Pin Saver helps with a manual Amazon affiliate to Pinterest workflow:

- Scans the visible Facebook post for likely product images and Amazon links.
- Converts full Amazon product links into clean URLs with your locally saved Associate tag.
- Resolves Amazon short links when Chrome can follow the redirect.
- Generates editable Pinterest title, description, hashtags, alt text, board suggestion, and topics.
- Opens Pinterest's create flow and copies the caption text so you can review and publish manually.

It does not track users, call analytics services, or submit/publish pins automatically.

---

## Quick Install

1. Clone this repository.
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode** (top right toggle).
4. Click **Load unpacked**.
5. Select this repository folder.
6. Open **Options**.
7. Add your Amazon Associate tag using a value like `yourtag-20`.
8. Open a Facebook post.
9. Click the Affiliate Pin Saver extension icon.

---

## First-Time Setup

| Setting | Where | Notes |
|---|---|---|
| Amazon Associate tag | Options page | e.g. `yourtag-20` |
| Default Pinterest board | Options page | Suggestion only; you select on Pinterest |
| Hover button | Options page | Toggle on/off |

---

## Workflow (Step by Step)

1. Open a **Facebook group or post** containing an Amazon deal.
2. Click the **Affiliate Pin Saver** extension icon in your toolbar.
3. The popup scans the visible page for product images.
4. **Select** the correct product image from the grid.
5. Review the detected **Amazon link** — the extension converts it to your affiliate URL.
6. If the link is a short URL (`amzn.to` / `a.co`), it will be resolved automatically.
7. Review and edit the generated **Pinterest title**, **description**, **hashtags**, and **alt text**.
8. Click **Open Pinterest Create** — Pinterest opens with the affiliate URL pre-filled.
9. On Pinterest, paste your description (already in clipboard), select your board, and **publish manually**.

> **This extension never auto-publishes pins.** You must choose the board and click Publish yourself on Pinterest.

---

## File Structure

```
repo root/
├── manifest.json          Chrome Extension manifest (MV3)
├── background.js          Service worker — short URL resolver, context menu
├── content.js             Injected into Facebook — image scan, caption extract
├── content.css            Hover button CSS for Facebook pages
├── popup.html             Extension popup UI
├── popup.css              Popup styles
├── popup.js               Popup controller logic
├── options.html           Settings page
├── options.css            Settings page styles
├── options.js             Settings save/load
├── utils/
│   ├── amazon.js          Amazon URL detection, ASIN extraction, affiliate conversion
│   ├── facebook.js        Facebook DOM heuristics (reference, not injected)
│   ├── pinterest.js       Pinterest URL builders, board/topic suggestions
│   └── textParser.js      Caption parsing, coupon detection, content generation
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## How Amazon Short Link Resolving Works

Short links like `https://amzn.to/3QXu8PE` or `https://a.co/d/abc123` are redirect URLs — the real Amazon product URL is only revealed when you follow the redirect.

The extension resolves them in `background.js`:

1. A browser `HEAD` request is sent to the short URL.
2. If `HEAD` fails, a browser `GET` request is tried.
3. Chrome follows the Amazon redirect and returns the final URL.
4. ASIN is extracted and the affiliate URL is built.

**If resolution fails** (network error, too many redirects, Amazon blocking HEAD requests):
- A warning is shown: *"Could not resolve short Amazon link. Paste final Amazon URL manually."*
- You can paste the full Amazon URL into the **Manual Amazon URL** field.

---

## Affiliate URL Conversion Logic

| Input | Result |
|---|---|
| `https://www.amazon.com/dp/B08N5WRWNW` | `https://www.amazon.com/dp/B08N5WRWNW/?tag=yourtag-20` |
| `https://amzn.to/3xyz` → resolves to `/dp/ASIN` | `https://www.amazon.com/dp/ASIN/?tag=yourtag-20` |
| URL with existing `?tag=oldtag` | Old tag replaced with your tag |
| URL with no ASIN | Original URL + `?tag=yourtag-20` (with warning) |
| Short link that fails to resolve | Warning shown, manual input needed |

**The extension never guesses ASINs.** If it cannot confirm the ASIN from the URL structure, it will warn you.

---

## Why Publishing Is Always Manual

Pinterest's API requires **OAuth authentication** and app approval for programmatic pin creation. This extension intentionally does **not** use the Pinterest API because:

1. Using the API requires Pinterest to approve your app (takes weeks and specific use cases).
2. Unapproved API calls can get accounts suspended.
3. Auto-publishing pins raises spam flags on Pinterest.
4. Manual review means you control quality, board selection, and timing.

Instead, the extension opens Pinterest's Create Pin page and copies all content to your clipboard for manual paste. This is the same approach used by most browser-based Pinterest savers.

---

## Test Fixtures

These captions are used to verify parsing. Paste them into the caption preview field manually to test:

### Test 1 — Short link + coupon code
```
[ad] ⚡ USB C Charger Block
This 2-pack USB C charger block is perfect for fast charging your devices at home or in the office.
https://amzn.to/3QXu8PE
```
Expected: detects `amzn.to` link, no coupon, tech category.

### Test 2 — Short link + coupon + Prime discount
```
[ad] 🥿 Foam Flip Flop Slippers
This cozy pair of memory foam flip flop slippers offers adjustable comfort and anti-slip soles—perfect for home or outdoor use.
Use: 5U2GZO7C + Prime discount
https://amzn.to/4ulUsRW
```
Expected: detects `amzn.to`, extracts coupon `5U2GZO7C`, deal type "Prime Discount", fashion/general category.

### Test 3 — Percentage off + concealer product
```
30% off🎉 Concealer & Lip Duo
#ad 🔗⬇️https://amzn.to/3P0vc4F
```
Expected: detects 30% off deal, beauty category, extracts link.

### Test 4 — 50% off electronics
```
This Skullcandy Crusher Evo Wireless Bluetooth Headphones is 50% OFF!!! Lmk when you grab!
https://amzn.to/4t9lNpA [ad]
```
Expected: 50% off deal, tech category, headphones product title.

### Test 5 — Full Amazon URL with ASIN
```
[ad] 🧂 Electric Salt and Pepper Grinder Set
https://www.amazon.com/dp/B09XYZ1234/?ref=xyz
Use: 7AQ7TNHY
```
Expected: extracts ASIN `B09XYZ1234`, builds clean affiliate URL, extracts coupon `7AQ7TNHY`.

---

## Debug Guide

### Extension icon is greyed out / not clickable
- Check that the popup is registered in `manifest.json` under `"action"`.
- Visit `chrome://extensions`, click the error badge if present.

### "Content script did not respond"
- Refresh the Facebook page after installing the extension.
- Facebook may have loaded before the content script was injected.
- Check `chrome://extensions → Affiliate Pin Saver → Errors`.

### No images detected
- Scroll down so the post is fully visible before opening the popup.
- Click **↻ Refresh** in the popup.
- Facebook uses lazy loading — images must be rendered in viewport.

### Short link not resolving
- Amazon may block `HEAD` requests from non-browser user agents.
- Click the short link yourself in a new tab, copy the full URL from the address bar, and paste it into **Manual Amazon URL**.

### Affiliate tag not being applied
- Go to **Options** and make sure your Associate tag is saved (e.g. `yourtag-20` — no spaces, no `tag=` prefix).

### Pinterest description not pre-filling
- Pinterest's web app sometimes ignores `?description=` URL params.
- The description is copied to clipboard automatically — just paste it in Pinterest's description field.

### "Multiple Amazon links found"
- Radio buttons will appear for each link. Select the correct product link (not a comparison site or shortener).

---

## Privacy

- **No data collection.** The extension never sends your data anywhere.
- **No external servers.** Short URL resolution uses Amazon's own redirect (your browser follows the redirect directly).
- **Local storage only.** Settings are stored in `chrome.storage.local` on your device.
- **No analytics, no tracking.** Zero telemetry.

---

## Limitations

| Limitation | Details |
|---|---|
| Facebook DOM changes | Facebook updates their HTML structure frequently. The extension uses heuristic selectors (aria roles, text signals) rather than class names to be more robust, but may need updates if Facebook restructures heavily. |
| Pinterest API | No board auto-selection without OAuth approval. Board selection is always manual on Pinterest. |
| Short link resolution | Amazon may throttle or block redirect resolution from extensions. Use manual URL paste as fallback. |
| Private Facebook groups | If a post is in a very restrictive group, images may load as data URIs or be blocked. |
| Multi-image carousels | Extension picks the first/highest-scored image. Scroll through the grid to find the right one. |
| Non-Amazon links | Only Amazon affiliate links are supported. |

---

## Legal & Compliance

- Always disclose affiliate relationships: `#ad As an Amazon Associate, I earn from qualifying purchases.`
- This extension generates the disclosure automatically in the Pinterest description.
- Prices and coupon codes change — the default disclaimer is included.
- Check Amazon Associates Program Operating Agreement and Pinterest's Advertising Guidelines before publishing.
- This extension is for **personal, manual workflow only**. Do not use it for bulk automated posting.

---

## Version History

| Version | Changes |
|---|---|
| 1.0.0 | Initial release |
