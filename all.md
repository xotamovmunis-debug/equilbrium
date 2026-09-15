# Equilibrium

AP Microeconomics and Macroeconomics practice: unit lessons, exam-style multiple choice,
timed mock exams with a predicted AP score, and an AI tutor.

The question bank starts empty. Everything is added through the console at `/admin`.

---

## What you need

Three free accounts: **GitHub**, **Supabase**, **Vercel**. Plus Node.js if you want to run
it on your own machine first — that part is optional.

Total setup time is about 40 minutes, most of it waiting for things to deploy.

---

## 1. Create the database

1. Go to supabase.com, create a project. Pick a region close to Uzbekistan — Frankfurt
   (`eu-central-1`) is usually the fastest. Save the database password somewhere.
2. Open **SQL Editor**, click **New query**, paste all of `supabase/schema.sql`, press **Run**.
   You should see "Success. No rows returned."
3. Open **Authentication → Users → Add user**. Use your own email and a strong password,
   and tick **Auto Confirm User**. This is your admin login.
4. Open **Project Settings → API**. Copy two values:
   - **Project URL**
   - **anon public** key

The anon key is meant to be visible in the browser. The policies in `schema.sql` are what
actually protect the data: visitors can read lessons and questions and file a result, and
nothing else. Never put the **service_role** key in this project.

---

## 2. Put the code on GitHub

```bash
cd equilibrium
git init
git add .
git commit -m "Equilibrium"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/equilibrium.git
git push -u origin main
```

To try it locally first:

```bash
npm install
cp .env.example .env.local     # then paste your two Supabase values in
npm run dev
```

---

## 3. Deploy

1. Go to vercel.com, **Add New → Project**, import the repository. Vercel detects Vite on
   its own, so leave the build settings alone.
2. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Project URL |
   | `VITE_SUPABASE_ANON_KEY` | your anon public key |

3. Deploy. You get `equilibrium.vercel.app` (or whatever project name you chose — rename it
   under **Settings → General** if the name is taken).

Every `git push` after this redeploys automatically.

---

## 4. Turn on the AI tutor

Skip this and the site still works; the tutor just reports that it is unavailable.

1. Get an API key from console.anthropic.com and add credit to the account.
2. In Supabase open **Edge Functions → Deploy a new function**, name it exactly `tutor`,
   and paste `supabase/functions/tutor/index.ts`.
3. Under **Edge Functions → Secrets**, add `ANTHROPIC_API_KEY` with your key.

The key lives on Supabase's servers. It is never sent to the browser, which is the whole
reason this function exists.

---

## 5. Point your domain at it

Once you own `equilibrium.uz` through a registrar such as ahost.uz, pscloud.uz or airnet.uz:

1. Vercel → your project → **Settings → Domains → Add** → type `equilibrium.uz`.
2. Vercel shows you the DNS records it wants. In your registrar's control panel, set the
   `A` record for the root to the IP Vercel gives you, and a `CNAME` for `www` to
   `cname.vercel-dns.com`.
3. Wait. DNS usually takes 15 minutes to a few hours. Vercel issues the HTTPS certificate
   by itself once the records resolve.

---

## Using the console

Open `/admin` directly, or press **Ctrl+Shift+A** anywhere on the site. Nothing links to it.
Sign in with the Supabase user you created.

- **Lessons** — notes, formula sheets and links, per unit. Plain paragraphs, `## ` for a
  subheading, `- ` for a bullet. "Draft with AI" writes a first pass you then edit.
- **Questions** — one at a time, tagged micro/macro, unit, and easy/medium/hard.
- **Write with AI** — drafts a batch for a unit. Nothing is published until you tick it and
  save it.
- **Results** — accuracy per unit, the questions students miss most, and every finished set.
- **Settings** — bulk import/export as JSON, and the mock exam score cutoffs.

To add another teacher, create them in Supabase under **Authentication → Users**. There is
no sign-up form on the site, which is deliberate.

---

## About the mock exam

Papers are drawn from your bank in College Board unit proportions, aiming for roughly
25% easy / 50% medium / 25% hard, up to 60 questions at 70 seconds each.

Scoring follows the published exam structure: 60 multiple-choice points plus 30 scaled from
the three free-response questions, for a composite out of 90.

The 1–5 cutoffs are **estimates**. College Board re-sets the conversion after every
administration and does not publish it. The defaults come from released exams and recent
score distributions, and you can change them in **Settings** whenever better data appears.

---

## Project layout

```
index.html                         page shell and meta tags
src/main.jsx                       entry point
src/App.jsx                        the whole application
src/lib/db.js                      Supabase client and every query
supabase/schema.sql                tables and row level security
supabase/functions/tutor/index.ts  AI proxy
vercel.json                        sends every path to index.html
```
