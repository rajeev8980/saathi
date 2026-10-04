# 💙 Saathi — Social App (Website + Android)

> **✅ This project is ALREADY DEPLOYED and live at https://saathi-2407f.web.app**
> Firebase project: `saathi-2407f`. Photos are stored as compressed base64
> data-URLs inside Firestore (no Cloud Storage bucket needed), so the
> "Storage" step in the guide below can be skipped.


A Facebook-style social app:
- 🤝 **Friend requests** — send / accept / reject / cancel / unfriend
- 💬 **Private chat** — you can message **only accepted friends** (enforced by database rules, so nobody can bypass it)
- 📝 **Posts** with photo + text and privacy per post:
  - 🌍 **Public** — everyone can see
  - 👥 **Friends** — only your accepted friends
  - ⭐ **Close Friends** — only people you marked with a star
  - 🔒 **Only Me** — private diary
- ❤️ Likes, 💬 comments, ↗ share
- 👤 Profiles like the reference screenshot (cover, avatar, bio, location, joined date, Activity / Likes tabs)

---

## 📁 Project structure

```
social-app/
├── public/                 → the website (HTML/CSS/JS)
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── firebase-config.js   ← paste your Firebase keys here
│       └── app.js
├── firestore.rules         → security rules (privacy + friends-only chat)
├── firestore.indexes.json  → required database indexes
├── storage.rules           → photo upload rules
├── firebase.json           → hosting config
├── .firebaserc             ← paste your project id here
└── android/                → Android app (WebView wrapper, open in Android Studio)
```

---

## 🚀 Step 1 — Create your Firebase project (free)

1. Go to <https://console.firebase.google.com> → **Add project** → name it (e.g. `saathi-app`) → continue (you can disable Analytics).
2. **Authentication** → Get started → **Email/Password** → Enable → Save.
3. **Firestore Database** → Create database → **Start in production mode** → choose location (e.g. `asia-south1` Mumbai).
4. **Storage** → Get started → production mode → same location.
5. Project Overview → ⚙️ **Project settings** → scroll down → **Add app** → **Web (`</>`)** → nickname `saathi-web` → it shows a config object.

## 🔑 Step 2 — Paste your keys

Open `public/js/firebase-config.js` and replace the `PASTE_YOUR_...` values with the config from Step 1.5.

Also open `.firebaserc` and replace `PASTE_YOUR_PROJECT_ID` with your project ID.

## 📤 Step 3 — Deploy (rules + website)

You need [Node.js](https://nodejs.org) installed. Then, in a terminal inside this folder:

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

This publishes your website at `https://YOUR-PROJECT-ID.web.app` **and** installs the security rules + indexes.

> Prefer doing it by hand? Rules can also be pasted in the Firebase Console:
> Firestore → Rules tab ← paste `firestore.rules` → Publish.
> Storage → Rules tab ← paste `storage.rules` → Publish.
> Indexes: Firestore → Indexes tab — or just use the app once; if an index is missing the app shows a toast and the browser console prints a one-click link that creates it.

## 💻 Step 4 — Test locally (optional)

```bash
npx serve public
```
Open <http://localhost:3000>. Create two accounts (use two browsers / incognito) and try:
1. User A searches User B → **Add Friend**
2. User B taps 🔔 → **Accept**
3. Now they can **Message** each other and see 👥 Friends posts.

## 🤖 Step 5 — Build the Android app

1. Install **Android Studio**.
2. **File → Open** → select the `android/` folder. Let Gradle sync finish.
3. Open `app/src/main/java/com/saathi/app/MainActivity.kt` and set:

   ```kotlin
   const val APP_URL = "https://YOUR-PROJECT-ID.web.app"
   ```
4. Connect your phone (USB debugging on) or use an emulator → press ▶ **Run**.
5. To share the app: **Build → Build App Bundle(s)/APK(s) → Build APK(s)** → the APK is in `android/app/build/outputs/apk/debug/` — send it to friends! 📲

---

## 🔒 How the privacy is enforced

Everything is checked **inside the database** (`firestore.rules`), not just hidden in the app:

| Action | Rule |
|---|---|
| Read a post | allowed if post is `public` **or** your uid is in the post's `audience` list |
| Create a chat | allowed **only** if the other person has you in their accepted `friends` |
| Send a message | same check — if someone unfriends you, sending stops working |
| Accept a request | only the receiver can change status to `accepted` |
| Friendship created | only when a matching accepted request exists |

⚠️ Notes / known limitations (fine for v1):
- The `audience` of a friends/close-friends post is a snapshot taken when posting. Friends added later won't see older friends-only posts.
- Post/avatar images are stored as Firebase download URLs (hard to guess, but anyone with the link can view them).
- Chat messages are not end-to-end encrypted.

## 🎨 Customising

- **App name**: change `Saathi` in `public/index.html`, `public/js/app.js` (welcome toast), `android/app/src/main/res/values/strings.xml`.
- **Theme colour**: change `--blue` in `public/css/style.css` and `@color/saathi_blue` in `android/.../colors.xml`.
- **App id**: change `applicationId` in `android/app/build.gradle`.

## 🧩 Ideas for v2 (easy to add later)

- Push notifications (Firebase Cloud Messaging)
- Photo messages in chat
- Post editing, comment deleting UI
- "Forgot password" email link
- Google login button
