# Petites Fiches — French vocabulary flashcards

A free website for A1 French learners: 1,576 words in 52 themed decks, audio, spaced repetition, quizzes, word of the day, accounts, a leaderboard and live Kahoot-style games.

It's a plain static site (HTML, CSS, JavaScript — no build step). Accounts, saved progress, the leaderboard and live games run on **Supabase** (free tier is plenty to start).

```
index.html              the app
privacy.html            privacy notice (template — review before a wide launch)
assets/config.js        ← the only file you must edit
assets/app.js           app logic
assets/app.css          design
assets/vendor/          Supabase client library (v2.117.2, bundled so no CDN is needed)
data/vocabulary.json    word list used by the app (compact)
data/vocabulary-full.json  the same list, easy to read and edit
tools/build_vocab.py    rebuilds vocabulary.json after you edit vocabulary-full.json
supabase/schema.sql     database tables and security rules
```

---

## Launch in about 20 minutes

### 1. Create the Supabase project (5 min)

1. Sign up at **supabase.com** → **New project**. Pick a region close to your users, set a database password, and wait for it to finish.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and press **Run**. You should see "Success. No rows returned."
3. Open **Project Settings → API** and copy two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string starting with `eyJ...` or `sb_publishable_...`)

   Never use the `service_role` / secret key in this website.

### 2. Put your keys in the site (1 min)

Open `assets/config.js` and replace the two placeholders:

```js
supabaseUrl: "https://abcd1234.supabase.co",
supabaseAnonKey: "eyJhbGciOi...",
contactEmail: "you@yourdomain.com",
```

### 3. Put the site online (5 min) — pick one

**Netlify (easiest, drag and drop)**
1. Go to **app.netlify.com/drop**.
2. Drag the whole project folder onto the page.
3. You get a live link like `https://petites-fiches-123.netlify.app`. Rename it under **Site configuration → Change site name**.

**Vercel (best if you use GitHub)**
1. Push this folder to a GitHub repository.
2. On **vercel.com → Add New → Project**, import the repo.
3. Framework preset: **Other**. Leave build command empty. Output directory: `.` → **Deploy**.

**Cloudflare Pages** also works: *Workers & Pages → Create → Pages → Upload assets*.

### 4. Tell Supabase your website address (2 min)

In Supabase → **Authentication → URL Configuration**:
- **Site URL**: your live address, e.g. `https://petites-fiches.netlify.app`
- **Redirect URLs**: add the same address followed by `/**`, e.g. `https://petites-fiches.netlify.app/**`
  (add `http://localhost:8000/**` too if you test on your computer)

This makes the email-confirmation and password-reset links open your site.

### 5. Test it

1. Open your live link on your phone. Study a few cards as a guest.
2. Tap **Log in → Create a free account**. Confirm the email, then come back — your guest progress moves into your account.
3. On a second phone (or a private browser window), create another account, then try **Play live** with a game code.

Share the link. That's it — you're live.

---

## Recommended before a wider launch

- **Emails**: Supabase's built-in email sender is limited to a few messages per hour — fine for friends, not for a public launch. Connect a mail provider (Resend, Brevo, SendGrid…) in **Authentication → Emails → SMTP Settings**, and customise the confirmation email text there.
- **Custom domain**: buy one (e.g. `petitesfiches.com`), connect it in Netlify/Vercel, then update both Supabase URL settings from step 4.
- **Google sign-in** (optional): create OAuth credentials in Google Cloud Console, add them in Supabase → **Authentication → Providers → Google**, then set `googleSignIn: true` in `assets/config.js`.
- **Privacy notice**: `privacy.html` is a starting template. Have it reviewed for the countries your users are in.
- **Name**: change `appName` in `assets/config.js`, plus the `<title>` and meta tags in `index.html` and `manifest.webmanifest`.

## Editing the words

Edit `data/vocabulary-full.json` (French, English, gender, notes, categories), then run:

```
python3 tools/build_vocab.py
```

and redeploy. Keep each card's `id` unchanged so learners keep their progress on it.

## Testing on your computer

```
python3 -m http.server 8000
```

then open `http://localhost:8000`. (Opening `index.html` by double-clicking won't work because the browser blocks loading the word list from a file.)

## How it works (for developers)

- **Routing**: hash-based (`#/deck/colours`, `#/game/K7QP`), so any static host works without rewrite rules.
- **Progress**: saved to `localStorage` instantly, then synced to `progress` (one JSON row per user) a moment later. Leaderboard stats are copied to `profiles`.
- **Security**: every table has row-level security. Users can only change their own progress, profile and game answers; only a game's host can move the game forward. Scores are calculated by the host's browser and profile points are written by each user's browser, so a determined user could fake their own score — fine for friends, but move scoring into a database function before offering prizes.
- **Live games**: Supabase Realtime pushes changes to `games` and `game_players`, with a 2.5-second refresh as a safety net. Games older than 2 days are deleted when someone hosts a new one.
- **Audio**: the browser's built-in French voice (Web Speech API). Quality depends on the device; recorded audio can be added later.

## Next steps

- SEO pages per deck and per word (a good fit for moving to Next.js later — the data file and database stay the same).
- Recorded native-speaker audio.
- The iOS app, reusing `vocabulary-full.json` and the same Supabase project, so accounts work on both.
