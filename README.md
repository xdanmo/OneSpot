# OneSpot

*A fast, decentralized web vault built entirely via "vibe coding" using Gemini 3.1 Pro / 3.5 Flash and Claude Opus 4.6.*

**OneSpot** is a lightning-fast, privacy-first, serverless Progressive Web Application (PWA) designed to be your personal vault for links, notes, to-do lists, and images. 

Instead of relying on a centralized database, OneSpot connects directly to your **Dropbox** account. All of your data—from your notes to your optimized images—lives entirely under your control on your own Dropbox storage. There are no backend servers, no hidden tracking, and no proprietary databases. You truly own your data.

## ✨ Features

- **Decentralized Storage:** Authenticates securely via OAuth and saves all data directly to your Dropbox account as a clean JSON file and raw images. 
- **Modern "Fluid Glass" UI:** Features a premium, state-of-the-art interface utilizing advanced CSS backdrop-filters and dynamic viewports to create stunning glassmorphism aesthetics.
- **Masonry Layout:** Your saved content is automatically organized into a beautiful, responsive masonry grid that adapts perfectly to both mobile and desktop screens.
- **Progressive Web App (PWA):** Installable directly to your home screen on iOS and Android. Features a built-in Service Worker for offline capabilities and rapid loading.
- **Built-in Image Optimization:** Automatically compresses, resizes, and generates thumbnails for your uploaded images *entirely in the browser* to save your Dropbox space and make loading incredibly fast.
- **Dark & Light Mode:** Seamlessly switch between a vibrant light mode and a sleek dark mode.
- **Native-feeling Interactions:** Includes pull-to-refresh, smooth sheet modals, staggered navigation animations, and perfect iOS scroll handling.

## 🚀 How It Works

Because OneSpot is a purely client-side application, it requires zero backend setup. 
1. **Login:** You authenticate with your Dropbox account.
2. **Sync:** The app reads a `data.json` file from your Dropbox App folder.
3. **Save:** When you add a new note or image, it instantly updates the DOM and seamlessly saves the file back to your Dropbox in the background.

## 🛠 Tech Stack

- **Core:** Pure Vanilla JavaScript (ES6+), semantic HTML5, and pure CSS.
- **Styling:** CSS Variables, Grid/Flexbox, and advanced backdrop-filters (No Tailwind or bulky CSS frameworks).
- **Backend/Storage:** Dropbox JavaScript SDK.
- **Icons:** Google Material Symbols.

## 📥 Local Development

To run this project locally, you will need to use your own Dropbox App Key, as the default key is restricted to the live production URL.

1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps) and create a new app (Scoped Access, App folder).
2. Add `http://localhost:8000` to your OAuth 2 Redirect URIs.
3. Open `app.js` and `login.html` and replace `CLIENT_ID` with your new App Key.
4. Clone the repository.
5. Because the application uses ES6 modules and the Dropbox API, it must be served over `http://` or `https://` (it will not work via `file://`).
6. You can use any local web server. For example, if you have Python installed, simply run:
   ```bash
   python -m http.server 8000
   ```
7. Open `http://localhost:8000` in your browser.

## 🛡 Privacy

OneSpot operates entirely in your browser. Your login token is passed directly between your browser and Dropbox. No analytics, no middleman servers, and no data harvesting. Your notes and images are strictly yours.
