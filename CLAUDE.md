# Bin & Shelf — project brief

A home storage inventory web app: record **where** things are stored and **what's inside** each container, then search for any item. The app must be installable on iPhone via Safari → Share → **Add to Home Screen**. It is hosted for free on **GitHub Pages**.

A working prototype already exists in `reference/bin-and-shelf-artifact.html`. It was built as a claude.ai artifact, so its storage calls (`window.claude.use("db")`, `window.claude.use("downloads")`) **will not work outside claude.ai**. Port the prototype. Don't redesign it: keep its UI, copy, design tokens and behaviour, and replace only the platform-specific parts listed below.

## What the app does (keep all of this)

- **Places**: the large storage areas (Garage, Attic, Storage unit 214). You can add, rename and delete a place. Deleting a place also deletes the containers inside it, after a confirmation.
- **Containers**: the bins, boxes and shelves inside a place. Fields:
  - `name` (for example "Christmas decorations")
  - `placeId`
  - `kind` (Tote / bin, Cardboard box, Shelf, Drawer, Cabinet, Bag, Rack, Pallet, Other)
  - `spot`, the exact location (for example "Metal shelf, left wall, top row")
  - `notes`
  - `code`, an auto-generated label such as `GAR-01`: the first 3 letters of the place plus the next free 2-digit number. The code never changes after the container is created.
  - `items[]`
  - `createdAt`, `updatedAt`
- **Items** are stored in an array inside each container: `{id, name, qty, note}`. Adding an item takes one line in the quick-add field. Tap an item to edit its quantity or note, or to remove it.
- **Search** runs across item names and notes, plus container names, codes, spots, notes and kinds. Item results show the path to the item: *code · container · place · spot*. The matched text is highlighted.
- **Screens**: Home (stats, list of places, unfiled containers, "All containers"), Place, Container detail, All containers (newest changes first), and Search results. The app needs its own back navigation (breadcrumbs) because an installed iOS web app has no browser back button.
- A fixed bottom bar holds **New place** and **New container**. Forms open in bottom sheets.
- **CSV export**, with columns: Place, Container, Code, Type, Exact spot, Container notes, Item, Qty, Item note.
- Light and dark themes follow the system setting. Keep the existing CSS tokens and the fonts (Archivo, IBM Plex Sans, IBM Plex Mono).

## What to change

### 1. Storage: replace `claude.use("db")` with local storage
- Use **IndexedDB** through a small wrapper. `idb-keyval` or a hand-written wrapper are both fine. Don't use localStorage for the main data.
- Put the storage behind one adapter module with the same shape the prototype uses:
  `subscribe(collection, cb)`, `add(collection, data) → id`, `update(collection, id, patch)`, `remove(collection, id)`.
  The collections are `places` and `containers`. This keeps the UI code nearly unchanged and leaves room to add a sync backend later.
- On startup, call `navigator.storage.persist()`. iOS Safari can clear data from websites that aren't used for a while, but apps installed to the home screen are mostly exempt from this. The data still exists only on one device, so backups matter.
- **Seed example data on first run only**: two places and three containers, all marked `sample: true`. Use the same records as the prototype, including the Christmas decorations bin. Keep the "Clear examples" banner.

### 2. Backup and restore
- **Export JSON**: a full backup of places and containers, with a version number.
- **Import JSON**: restore from a backup file. Confirm before replacing the current data.
- **Export CSV**: keep the existing export.
- Downloads: on iOS, use `navigator.share({files:[...]})` when `navigator.canShare` supports files. Otherwise fall back to a Blob URL on an `<a download>` link.
- Put these options in the settings sheet (the gear icon). Show a gentle reminder if no backup has been made in 30 days.

### 3. Installing on iOS (PWA)
- Add `manifest.webmanifest` with `name` "Bin & Shelf", `short_name` "Bin & Shelf", `display: "standalone"`, `start_url: "./"`, `scope: "./"`, and `theme_color`/`background_color` taken from the design tokens (`#1B6B57`, `#F1F4F2`).
- Add icons: `apple-touch-icon.png` at 180×180, plus 192×192 and 512×512 PNGs (include a maskable one). Draw a simple bin glyph like the header's brandmark on the pine-green background. Generate the PNGs from an SVG in the repo.
- In `<head>`, add `<meta name="apple-mobile-web-app-capable" content="yes">`, `apple-mobile-web-app-status-bar-style` set to `default`, `apple-mobile-web-app-title`, and a viewport meta with `viewport-fit=cover`. Keep the prototype's safe-area padding.
- Add a **service worker** that pre-caches the app shell and fonts, so the app opens and works offline in a garage with no signal.
- The Google Fonts `<link>` must still fall back cleanly when the device is offline.

### 4. Remove the claude.ai-only pieces
- Remove the `window.claude` checks and the "Inventory unavailable" offline state.
- The prototype HTML has no `<!doctype>`, `<html>`, `<head>` or `<body>` because the artifact host added them. Add them back.

## Repo and hosting
- Plain static files. A build step is optional, so only add one (for example Vite) if it clearly earns its place. Suggested layout:
  ```
  index.html
  app.js          (or src/…)
  store.js        (IndexedDB adapter)
  styles.css
  sw.js
  manifest.webmanifest
  icons/
  reference/      (the original prototype, keep for comparison)
  ```
- Deploy with **GitHub Pages** through a GitHub Actions workflow (`.github/workflows/pages.yml`) on every push to `main`.
- Every path must be **relative** (`./`), because the site is served from `https://<user>.github.io/<repo>/`.
- Add a short README covering how to install the app on iPhone and how to back up.

## Done when
- [ ] Every feature listed above works in desktop Chrome and in iOS Safari.
- [ ] After Add to Home Screen, the app opens full screen with the right icon and name, and without the Safari UI.
- [ ] Data survives closing and reopening the app, and a JSON export → import round trip restores it exactly.
- [ ] The app opens and can be edited while offline, after its first load.
- [ ] Lighthouse PWA / installability checks pass.
- [ ] The Pages site is live and linked in the README.

## Later (not now)
Syncing across devices and sharing with family would need a backend, for example Supabase or Firebase with sign-in. Keep the storage adapter clean so that backend can be added later without touching the UI.
