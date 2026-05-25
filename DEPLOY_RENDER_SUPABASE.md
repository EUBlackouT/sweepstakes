# Deploy Sweepstake (Render + Supabase)

## 1) Create Supabase project

1. Create a new Supabase project.
2. Open SQL editor and run `supabase/schema.sql`.
3. Copy:
   - Project URL
   - anon public API key

## 2) Configure local env

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_ROOM_ID` (pick one room id, e.g. `cheesy-world-cup`)
- `VITE_SIDE_LEFT_IMAGE` (optional, default `/side-left.jpg`)
- `VITE_SIDE_RIGHT_IMAGE` (optional, default `/side-right.jpg`)

## 3) Verify locally

```bash
npm install
npm run dev
```

Open two browsers/devices. Changes should sync automatically.

## 4) Push to a brand-new GitHub repo

```bash
git init
git add .
git commit -m "Initial Cheesy sweepstake app"
git branch -M main
git remote add origin <YOUR_NEW_REPO_URL>
git push -u origin main
```

## 5) Deploy on Render (Static Site)

1. Render -> New -> Static Site -> pick repo.
2. Build command:
   - `npm install && npm run build`
3. Publish directory:
   - `dist`
4. Environment variables in Render:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SUPABASE_ROOM_ID`
   - `VITE_SIDE_LEFT_IMAGE` (optional)
   - `VITE_SIDE_RIGHT_IMAGE` (optional)
5. Deploy.

## Notes

- App state is shared through Supabase table `sweepstake_state`.
- Realtime updates use Supabase Realtime + periodic cloud pull fallback.
- Admin PIN remains client-side UI gating.
