<!--
  Template for the README of the Satchel repository (https://github.com/{satchel}).
  push.py fills in the {placeholders} and publishes it with every release, so edit this file, not the one in that repo.
  Pictures load from the Caravan commit the release was built from, so they always match the app.
-->

<p align="center">
  <img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-logo.png" width="84" alt="Satchel logo">
</p>

<h1 align="center">Satchel</h1>

<p align="center"><b>Your Caravan library in your pocket: every book, your place in it, and pages you can actually turn.</b></p>

<table align="center"><tr>
<td><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-home.jpg" width="230" alt="Satchel's home screen with Dune at 42% and the update ribbon"></td>
<td><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-shelf.jpg" width="230" alt="The library as a wooden bookcase of spines"></td>
<td><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-reader.jpg" width="230" alt="Dune open as a single page on a walnut desk"></td>
</tr></table>

Satchel is the Android app for **[Caravan](https://github.com/{caravan})**, the self-hosted e-book and comic server. It connects to your own Caravan server the way the Jellyfin app connects to Jellyfin: enter the address, sign in, and your whole library is there. Your reading position, bookmarks, highlights, favourites and collections are kept on the server, so you can carry on in the browser or on another phone.

<p align="center">
  <a href="https://github.com/{satchel}/releases/latest/download/{apk}"><b>⬇ Download Satchel.apk</b></a> · <a href="https://github.com/{satchel}/releases">All releases</a> · <a href="https://github.com/{caravan}">Caravan (the server)</a>
</p>

| | |
|---|---|
| Latest version | **{versionName}** |
| Build | {versionCode} |
| Requires | Android {minAndroid} or newer, and a Caravan server |
| Built from | Caravan [`{source}`](https://github.com/{caravan}/commit/{source}) |

---

## Contents

| | |
|---|---|
| [Install](#install) | Download, install and connect, in four steps |
| [The app at a glance](#glance) | Tabs, shelves and the update ribbon |
| [Reading](#reading) | Turning pages, highlights, display settings |
| [Your library](#library) | Bookshelf, books, series and collections |
| [Troubleshooting](#troubleshooting) | Fixes for common problems, step by step |
| [Reference](#reference) | Permissions, what's stored where, versions |

---

<a id="install"></a>

## Install

You need a Caravan server running on your network first. Its **[README](https://github.com/{caravan}#quick-start)** covers TrueNAS, Docker and Windows.

### Step 1: Download

On your phone, open **[Satchel.apk](https://github.com/{satchel}/releases/latest/download/{apk})**. You can also press **Get Satchel** at the top of the Caravan web app.

### Step 2: Install

1. Open the downloaded **Satchel.apk** from the notification or your **Downloads**.
2. Android asks to **allow installing unknown apps** for your browser or file manager. Allow it, go back, and press **Install**.
3. Newer versions install over older ones. You won't lose anything, because your reading lives on the server.

### Step 3: Connect to your server

<table><tr>
<td width="260"><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-connect.jpg" width="240" alt="Connect to a server, with http://192.168.1.50:8420 typed in"></td>
<td>

1. Type your server's address, for example **`http://192.168.1.50:8420`**. That's the IP of the machine running Caravan, with port **8420**.
2. If you leave off `http://` or the port, Satchel adds them for you.
3. Press **Connect**.

> **Tip:** first open the same address in your phone's browser. If the page loads there, Satchel will connect too.

If it can't connect, the message under the box says why. See [Troubleshooting](#troubleshooting).

</td></tr></table>

### Step 4: Sign in

<table><tr>
<td width="260"><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-login.jpg" width="240" alt="Sign in to Caravan with username reader"></td>
<td>

1. Enter your Caravan **username** and **password**. These are the same as on the web.
2. Press **Sign in**.

You stay signed in until you sign out. **Change server** under the button takes you back to step 3.

</td></tr></table>

---

<a id="glance"></a>

## The app at a glance

<table><tr>
<td width="260"><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-home.jpg" width="240" alt="The home screen"></td>
<td>

| Where | What it does |
|---|---|
| **Update ribbon** (top) | Appears when a newer Satchel is released. **Update** downloads it; **✕** hides it until the next release. |
| **Featured book** | The book you're reading. **Continue** opens it where you left off, even if you were last reading in the browser. |
| **Shelves** | Continue reading, Recently added and Favorites. Swipe sideways; **See all** lists everything. |
| **Bottom bar** | **Home**, **Library**, **Search** and **Settings**. |
| **Top bar** | Administration (admins), Settings and Sign out. |

</td></tr></table>

The Android **back** button or back gesture works as you'd expect. It closes whatever is open (a menu, a dialog, the reader's panels), then goes back a screen. On Home, it puts Satchel in the background.

---

<a id="reading"></a>

## Reading

<table><tr>
<td width="260"><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-reader.jpg" width="240" alt="A page of Dune on the desk, with the chapter and page counter below"></td>
<td>

| Do this | To… |
|---|---|
| Tap the **right** or **left** side | turn forward or back |
| **Drag a corner or the edge** | turn the page by hand. It curls from wherever you grab it, and you can let it fall back. |
| Tap the **middle** | show the menus: Contents, Bookmark, Search, Display (**Aa**), and the progress bar |
| **Long-press** a word, then drag | select text, then pick one of five highlight colours, add a note, or copy |
| **Contents → Bookmarks & highlights** | see your notes and jump to any of them |
| **Back** | close the menus or panels first, then leave the book |

</td></tr></table>

**Display (Aa):** Light, Sepia, Dark or Black theme; **Book on a desk** (a real 5 × 7 page on walnut, oak, slate, linen, leather, night, or your own photo) or **Full screen** text; **Page curl**, **Slide** or **Instant** page turns; font, size, spacing, margins, brightness, and keep the screen on.

If a book has **several versions** (for example EPUB and PDF), pick one on the book's page. Your place and highlights carry across.

---

<a id="library"></a>

## Your library

| Bookshelf | A book | A series |
|:-:|:-:|:-:|
| <img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-shelf.jpg" width="230" alt="The bookcase"> | <img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-book.jpg" width="230" alt="A Court of Mist and Fury's page at 64%"> | <img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-series.jpg" width="230" alt="The A Court of Thorns and Roses series page"> |
| **Library → covers / bookshelf** switches between a cover grid and a bookcase of spines. Series stand together, with bookends. | **Continue reading**, progress, download, add to a collection, favourite, mark finished. | Your progress through the series and **Continue the series**, then the reading order. |

- **Select several books:** long-press one, tap the others, then **Add to collection** or **Add to series**.
- **Search** finds titles, authors, series, tags and ISBNs.
- Adding books, covers and spines happens on the server: drop files into its folders and they appear within seconds. See the [Caravan README](https://github.com/{caravan}#step-3).

### Appearance

<table><tr>
<td width="260"><img src="https://raw.githubusercontent.com/{caravan}/{source}/docs/img/satchel-settings.jpg" width="240" alt="Settings: Oasis & Saddle selected, Dark mode"></td>
<td>

**Settings → Appearance:** Satchel starts in **Oasis & Saddle**; **Terracotta & Amber** is the other palette. Choose **Dark**, **Light** or **System**.

This is saved on the phone only, so Satchel and the web app can look different. **Reading defaults** below it set the theme, desk and font for every book.

</td></tr></table>

---

<a id="troubleshooting"></a>

## Troubleshooting

### 1. "No answer from … after 15 s" or "Couldn't connect to …"

1. Open the same address in the **phone's browser**.
   - **`ERR_ADDRESS_UNREACHABLE`:** the phone can't reach that network. Join your home Wi-Fi (not mobile data or a guest network). If you reach home through **Tailscale** or another VPN, switch it on.
   - Loads in the browser but not in Satchel: in Tailscale, open **Settings → Split tunneling** and make sure Satchel isn't excluded.
2. Use the server's **IP address** (for example `192.168.1.50`), not a name like `truenas.local`. Android often can't look those names up.
3. Don't use a `172.16.x.x` or `172.17.x.x` address from the server's logs; those are internal to Docker.

### 2. "… answered with HTTP …" or "… isn't a Caravan server (wrong port?)"

Something answered, but it isn't Caravan. Check the port: Caravan uses **8420** unless you changed it.

### 3. "Can't reach … Check the address or that the server is running"

Satchel was connected before but the server isn't answering now. Check the server is on (in TrueNAS: **Apps → caravan** shows **Running**). Press **Change server** if its address has changed.

### 4. Android won't install the update

1. Allow your browser or file manager to install unknown apps (Step 2).
2. If Android says the update conflicts with the installed app, uninstall Satchel and install the new one. You only need to enter the server address and sign in again; everything else is on the server.

### 5. The back button closes the app

You're on an old version. Install the [latest release](https://github.com/{satchel}/releases/latest), which handles back and the back gesture.

---

<a id="reference"></a>

## Reference

| | |
|---|---|
| Android | {minAndroid} or newer |
| Permissions | Internet only |
| Stored on the phone | your server's address, your sign-in, and your appearance choice |
| Stored on the server | everything else: books, progress, bookmarks, highlights, notes, favourites, collections, and your reading-display choices |
| Connections | your Caravan server, plus GitHub once in a while to check for new releases |
| Plain `http://` | allowed, so you can use a home-network address |
| Updates | every release is built from Caravan; the version and build number are on the [releases page](https://github.com/{satchel}/releases) |

Satchel is the Caravan web app inside a native Android shell (Capacitor). It reads exactly like the browser version and gets the same features at the same time. This repository holds only the release information; the source is in **[Caravan](https://github.com/{caravan})** under `mobile/`.
