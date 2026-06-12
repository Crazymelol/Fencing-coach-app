# 🤺 Fencing Coach — Touch Recorder

A touch-screen web app for fencing coaches. Tap the piste where a touch
happened, record whether it was an **attack** or a **defence**, and the app
keeps score, stores everything, and builds statistics per athlete.

## Workflow

1. **Setup** — enter the two fencers' names (previously used names are
   suggested automatically), pick the bout length (5 or 15 touches) and
   whether it's a 🏋 training or 🏆 competition bout.
2. **Bout** — a 14 m piste is shown with centre line, on-guard lines and the
   2 m warning zones. Tap where the touch happened, then answer two quick
   questions: *who scored?* and *attack or defence?*
3. When a fencer reaches the target score the bout ends and saves
   automatically, and you move straight on to the next bout (or a rematch
   with swapped sides). You can also undo the last touch or end a bout early.

## Statistics

Pick any athlete to see:

- bouts, wins and win rate
- touches scored / received and the indicator (+/−)
- attack vs defence percentages
- a **touch map** on the piste, normalised so the athlete's own end is always
  on the left — shows where they score (attack/defence) and where they concede
- a histogram of touches per 2 m piste zone and the average scoring position
- full bout history, filterable by training/competition

Tap any bout in a list to open its **individual breakdown**: final score,
touch map for that bout (border colour = which fencer scored), attack/defence
counts per fencer, and a touch-by-touch timeline with positions and the
running score.

Data can be exported as **JSON** or **CSV** for further analysis.

## Storage

Bouts are stored **online** in a Supabase Postgres database (table `bouts`),
so every device sees the same club data and nothing is lost if a tablet is
wiped. The app also keeps a `localStorage` cache: if you record bouts with no
internet connection they are saved locally and pushed automatically the next
time the app is online (a status line at the top shows the sync state).

The app talks to Supabase with its public *publishable* key and open
row-level-security policies — anyone using the app shares one club database.
If you ever need per-coach accounts, add Supabase Auth and tighten the RLS
policies.

## Running it

**Live now** (served straight from this public repo via githack):

> https://raw.githack.com/Crazymelol/Fencing-coach-app/claude/fencing-touch-recorder-2b7uo9/index.html

For a permanent address, enable GitHub Pages once: repo **Settings →
Pages → Deploy from a branch**, pick this branch and `/ (root)` — the app
will then be at `https://crazymelol.github.io/Fencing-coach-app/`.

It's a static site with no build step, so any static server also works
(`python3 -m http.server`), or just open `index.html` in a browser.
Designed for tablets/phones (large touch targets, responsive layout) but works
on desktop too.
