# Bin & Shelf

A home storage inventory you can keep in your pocket. Record **where** things are
stored — garage, attic, unit 214 — and **what's inside** each bin, box or shelf,
then search for anything by name, note or label code.

Things that aren't in a bin at all — a ladder, a bike, a spare mattress — can be
listed straight against the place they stand in.

It is a plain static web app: no accounts, no server, no build step. Everything
you enter is stored on the device in IndexedDB, and the app works offline once it
has loaded.

**Live site:** https://&lt;your-github-username&gt;.github.io/&lt;repo&gt;/
*(fill this in after the first deploy — see [Hosting](#hosting-on-github-pages))*

---

## Install it on your iPhone

1. Open the live link in **Safari** (not inside another app's browser).
2. Tap the **Share** button — the square with the arrow.
3. Choose **Add to Home Screen**, then **Add**.

It then opens full screen with its own icon, no Safari chrome, and works with no
signal — which is the point, since most garages have none.

On Android or desktop Chrome, use the install icon in the address bar.

## Back it up

The inventory lives on **one device**. Nothing syncs. So export a copy now and
then — the app reminds you if it has been 30 days.

Tap the **gear icon**, then:

- **Export JSON** — the full backup: every place, container and item. This is the
  one to keep.
- **Export CSV** — a spreadsheet of the contents (Place, Container, Code, Type,
  Exact spot, Container notes, Item, Qty, Item note). Good for printing or
  sharing; it is not a restore file.
- **Restore from JSON** — pick a backup file. It asks before replacing what is
  currently in the app.

On iPhone the export opens the share sheet, so you can save straight to Files or
iCloud Drive. On desktop it downloads.

To move your inventory to a new phone: export JSON on the old one, open the app
on the new one, restore from that file.

## Things that aren't in a container

Open a place and scroll past its containers to **Not in a container**. The
quick-add line there files an item against the place itself — no bin, box or
shelf needed. Tap the item afterwards to set a quantity or a note, the same as
anywhere else.

Loose items are counted in the place's item total, turn up in search with
*Garage · not in a container* as their location, and appear in the CSV export
with `(not in a container)` in the Container column.

## Label codes

Every container gets a short code such as `GAR-04` — the first three letters of
the place plus the next free number. Write it on a strip of tape on the real bin.
Then you can read a code off a bin and search it in the app, or find a code in
the app and walk straight to the bin. The code never changes once assigned.

## Hosting on GitHub Pages

The site deploys itself on every push to `main`.

1. Create a repository on GitHub and push this folder to it:
   ```sh
   git init
   git add .
   git commit -m "Bin & Shelf"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repository, go to **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. Push. The workflow in `.github/workflows/pages.yml` stages the static files
   and publishes them. The URL appears in the workflow run summary and under
   Settings → Pages.
4. Put that URL at the top of this README, and open it on your phone.

Every path in the app is relative, so it works from a project subpath
(`https://you.github.io/repo/`) without configuration.

### Updating the app on a phone that already has it

The service worker serves the cached copy first, then updates in the background.
Close and reopen the app once after a deploy to pick up the new version.

## Running it locally

Any static file server will do — a `file://` page cannot register a service
worker or open IndexedDB reliably.

```sh
python -m http.server 8080
# then open http://localhost:8080/
```

## What is in here

```
index.html            the shell: header, search, bottom bar
app.js                screens, search, sheets, CSV/JSON export and import
store.js              the IndexedDB adapter (subscribe / add / update / remove)
styles.css            design tokens, light and dark themes
sw.js                 service worker: offline app shell and font cache
manifest.webmanifest  name, icons, standalone display
icons/                icon.svg and the PNGs generated from it
tools/make-icons.py   regenerates the PNGs from the SVGs (needs Pillow)
reference/            the original claude.ai prototype, kept for comparison
```

### Data model

Two collections.

```js
place     = { id, name,
              items: [ { id, name, qty, note } ],   // the loose things
              createdAt, updatedAt, sample? }
container = { id, name, placeId, kind, spot, notes, code,
              items: [ { id, name, qty, note } ],
              createdAt, updatedAt, sample? }
```

An item hangs off whichever owner it belongs to — a container, or a place when it
is in no container. Both owners use the same `items` shape, so the list, the item
sheet, search, export and restore treat them alike.

`store.js` is the only file that knows about IndexedDB. It exposes
`subscribe(collection, cb)`, `add(collection, data)`, `update(collection, id, patch)`
and `remove(collection, id)`, so a sync backend (Supabase, Firebase) could be
dropped in later without touching the UI.

### Example data

On the very first run the app seeds two example places and three containers (plus
one loose item, the extension ladder in the garage), all flagged `sample: true`,
with a banner offering to clear them. Clearing removes only the examples. They
are never re-seeded.

### Regenerating the icons

Edit `icons/icon.svg` (and `icon-maskable.svg` / `icon-square.svg`), then:

```sh
python tools/make-icons.py
```
