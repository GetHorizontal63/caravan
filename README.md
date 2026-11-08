# Caravan

**Caravan** is a self-hosted e-book and comic server in the spirit of Jellyfin, and **[Satchel](https://github.com/GetHorizontal63/satchel)** is its Android app. Point Caravan at your folders of books and comics, and read them from any browser, the desktop app, the Android app, or any OPDS reader (KOReader, Moon+ Reader, Librera…). Metadata and cover art are matched automatically by ISBN, with title and author search as a fallback, using Open Library and Google Books.

```
┌──────────── clients ────────────┐        ┌──────────────── server (Node 24) ────────────────┐
│ Web / PWA (React)               │  HTTP  │ Fastify REST API  ·  OPDS 1.2 catalog             │
│ Desktop (Electron shell)        │ ─────▶ │ Library scanner → format extractors (EPUB, MOBI,  │
│ Android (Capacitor shell)       │        │   AZW3, FB2, PDF, CBZ/CBR, Calibre sidecars)       │
│ KOReader / Moon+ / … (OPDS)     │        │ Metadata: ISBN → Open Library / Google Books      │
└─────────────────────────────────┘        │ Converters: CBR→CBZ, TXT/MD/HTML→EPUB, Calibre    │
                                           │ SQLite (node:sqlite) · cover cache (sharp)        │
                                           └───────────────────────────────────────────────────┘
```

## Features

**Reading** (in the browser, so it works the same on every client)
- EPUB 2/3, Kobo EPUB, MOBI, AZW, AZW3/KF8, FB2/FBZ and CBZ open natively via [foliate-js](https://github.com/johnfactotum/foliate-js); PDF opens via pdf.js.
- CBR, TXT, Markdown and HTML are converted on the server the first time they're opened, then cached. DOCX, ODT, RTF, LIT, PDB and LRF work when Calibre is installed.
- Mobile-first reader: tap the left or right side to turn pages, tap the middle for menus, swipe, use the keyboard, or drag the progress scrubber.
- Light, Sepia, Dark and Black themes; font, size, line spacing, margins, line length, justification and hyphenation; paged or scrolling layout; one or two columns.
- Table of contents, bookmarks, highlights in five colours with notes, and full-text search.
- PDF: fit to page or width, pinch / Ctrl+wheel zoom, and themes that also recolour the page. Comics: natural page order and a right-to-left (manga) mode.
- Reading position syncs across devices per user, along with minutes left in the chapter, a keep-screen-on option and a brightness control.

**Book on a desk**
- Pages are 5:7, with two-page spreads when the screen is wide enough. The book has a cloth cover, page-edge stacks that track your progress, and a shaded spine gutter. The page counter sits on the desk below the book.
- Page curl that follows where you grab: corners, edges, or a top or bottom pull. Going back is the forward turn mirrored, so the left page lifts from its outer edge. In spreads only the leaf turns, and its back shows the real page printed there.
- The desk can be walnut, oak, slate, linen, leather, night, or your own uploaded photo, with a dimmer. "Full screen" is available for edge-to-edge text.

**Library**
- Multiple libraries (books or comics), each with several folders. Library folders are watched: adding, removing or renaming books, or changing anything in `covers/` / `spines/`, triggers a rescan of that library about 15 seconds after things go quiet. Scans also run on a schedule and on demand.
- **Collections** in each library: hand-picked groups with cover collages, an order you can rearrange, and an "Add to collection" button on every book. Anyone can create one; the creator or an admin can edit it.
- **Series** from metadata or created by hand. Admins can start a series, add books, renumber, rename or merge, or set a book's series from its page. Manual edits are never overwritten by automatic lookups.
- Metadata is read from the files themselves (OPF, EXTH, FB2 description, PDF info, ComicInfo.xml) and from Calibre `metadata.opf` / `cover.jpg` sidecar files.
- **One book, several formats**: files with the same name in the same folder (`Dune.epub`, `Dune.pdf`, `Dune.azw3`) are one book. Its page lists each version to read or download, and the best format for reading is the default. Your place, bookmarks, highlights and notes follow you between versions. A position from another format opens at the same point in the book, and highlights are found again by their text: exactly in EPUB, MOBI, AZW3, FB2 and converted text, and as "about here" in PDFs. Removing one file keeps the book as long as another version is left.
- **Your own art**: every folder that holds books gets a `covers/` and a `spines/` folder; comic libraries get `covers/` only. The scanner creates them if the library is writable. Put a JPG, PNG or WebP in one with the same name as the book file (`Dune.epub` → `covers/Dune.jpg`, `spines/Dune.png`) and it replaces the embedded or downloaded art on the next scan. A close name also works (`Dune.jpg` for `Frank Herbert - Dune.epub`). In a folder with a single book, any image name works. A cover or spine image placed right beside the book wins over both folders: `cover.jpg` / `spine.png` when the folder holds just that book, or `Dune.cover.jpg` / `Dune - spine.png` in any folder. Editing the image updates it on the next scan; a spine photographed lying down is stood upright automatically.
- **Bookshelf view**: switch any library between covers and a wooden bookcase of spines. Series are shelved together first (A–Z, in reading order, with bookends between them), then the remaining books in the chosen sort. Books without spine art get a generated spine in their cover's colour, with title, author and series number; its width follows the page count.
- If the file has no ISBN in its metadata, the scanner looks for one on the copyright pages (EPUB and PDF text) and in the file name.
- **Identify** (as in Jellyfin): search by ISBN or by title and author, compare candidates from each provider with their covers, and apply one. You can also edit metadata, lock it, or upload or link a cover.
- Each user has Continue reading, Recently added, Favorites, Finished and Unread views, browsing by author, series and tag, and search.
- Admins can upload books from the browser, manage users, and change server settings.

## Quick start: Docker (recommended, works on TrueNAS)

```bash
docker compose up -d --build     # edit the /books volume path in docker-compose.yml first
```

Open `http://<host>:8420`. The first-run wizard creates the admin account, then add a library pointing at `/books`.

| Volume | Purpose |
|---|---|
| `/config` | SQLite database, cover cache, converted-file cache |
| `/books` (any path) | Your library folders; mount read-only (`:ro`) if you don't want uploads |

Add Calibre support for the extra formats with `docker compose build --build-arg INSTALL_CALIBRE=true` (the image grows by about 1 GB).

## Quick start: Windows

Requires [Node.js 24+](https://nodejs.org).

```powershell
npm run install:all
npm run build                      # builds web/dist
npm start                          # http://localhost:8420, data in .\data
```

To run at boot, use `scripts\windows\install-service.ps1` from an elevated PowerShell. It registers a startup task under SYSTEM and opens the firewall port.

> **Build from a local drive.** npm workspace symlinks, TypeScript 7 and Vite 8's bundler (Rolldown) all fail on UNC paths (`\\server\share\...`). Either clone to a local disk or a mapped drive letter, or build in Docker. Running the server from a UNC path works fine.

## Clients

| Client | How |
|---|---|
| Browser / PWA | Open the server URL. On phones use *Add to Home screen*: it installs as a full-screen app. |
| Desktop (Win/macOS/Linux) | `cd desktop && npm install && npm start` (or `npm run dist` for an installer). Asks for the server address on first launch. |
| Android (Satchel) | Install the latest **[Satchel release](https://github.com/GetHorizontal63/satchel/releases/latest)** (sideload: allow *Install unknown apps*). On first launch enter the server address, then sign in. See [Building Satchel](#building-satchel-the-android-app). |
| OPDS apps | Add the catalog `http://<host>:8420/opds` and sign in with your Caravan user. |

## Building Satchel (the Android app)

The Android project lives in `mobile/android` (Capacitor 8, minSdk 24 / Android 7, targetSdk 36). The app bundles the web client and talks to your server over HTTP/HTTPS. Plain HTTP to LAN addresses is allowed.

Requirements: Android Studio (or JDK 21 + Android SDK). Gradle downloads any missing SDK platform automatically. Build from a **local drive**, because Gradle and Vite don't work on a `\\server\share` path.

```bash
npm run build --prefix web             # 1. build the web client
cd mobile && npm install
npm run sync                           # 2. copy web/dist into the app (also re-run after web changes)
node patch-android.cjs                 #    (only needed if you regenerated android/)
cd android
echo sdk.dir=C\:/Users/<you>/AppData/Local/Android/Sdk > local.properties   # or set ANDROID_HOME
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr
gradlew assembleDebug                  # 3. → android/app/build/outputs/apk/debug/app-debug.apk
```

Or run `npm run open` to build, run and sign a release from Android Studio. For a Play-store or signed release build, create a keystore and use *Build → Generate Signed App Bundle/APK*.

## Configuration (environment variables)

The older `JR_*` names still work.

| Variable | Default | |
|---|---|---|
| `CARAVAN_PORT` | `8420` | HTTP port |
| `CARAVAN_HOST` | `0.0.0.0` | Bind address |
| `CARAVAN_DATA_DIR` | `./data` | Database and caches |
| `CARAVAN_WEB_DIR` | `./web/dist` | Built web client |
| `CARAVAN_CALIBRE_CONVERT` | – | Path to `ebook-convert`; enables DOCX/ODT/RTF/LIT/PDB/LRF |
| `CARAVAN_SCAN_ON_START` | `1` | Set `0` to skip the startup scan |
| `CARAVAN_WATCH` | `1` | Set `0` to stop watching library folders (rely on scheduled/manual scans only) |
| `CARAVAN_LOG_LEVEL` | `info` | |

Other settings live in **Admin → Metadata & server**: server name, provider priority, automatic matching, rescan interval, and the Google Books API key.

> **Get a Google Books API key.** It's free (Google Cloud Console → enable *Books API* → Credentials). Without one, Google's anonymous quota is shared worldwide and is usually exhausted, so matching falls back to Open Library alone.

## Metadata matching

1. Read embedded metadata, then a Calibre sidecar if present, then fall back to the file name (`Author - Title (Year).ext`).
2. Find an ISBN in the metadata, on the copyright pages, or in the file name, then validate its checksum and normalise it to ISBN-13.
3. With an ISBN, look it up on every provider and merge the results: the first provider in priority order wins, and the others fill in missing fields.
4. Without one, run a title and author search, and accept a result only if fuzzy title and surname matching is confident (≥ 0.8).
5. Empty fields are filled, but nothing is overwritten unless you use **Identify** or **Edit**. Locked books are never touched.

## Development

```bash
npm run dev:server     # API on :8420 (node --watch, runs TypeScript directly)
npm run dev:web        # Vite on :5173, proxies /api and /opds to :8420
npm run typecheck
```

Layout: `server/src` (API, scanner, `extract/` per-format readers, `metadata/` providers, `convert.ts`), `web/src` (pages, `reader/` engines and reader UI, `admin/`), `desktop/`, `mobile/`, `scripts/`.

## Roadmap ideas
- Offline downloads in the Android app; Kobo/KOReader progress sync (kosync)
- Collections/shelves, reading stats, per-library user permissions
- Hardcover / Comic Vine providers, series detection from providers
- Text-to-speech (foliate-js ships a TTS module)
