# 🤺 Fencing Coach — Touch Recorder

A touch-screen web app for fencing coaches. Tap the piste where a touch
happened, record whether it was an **attack** or a **defence**, and the app
keeps score, stores everything, and builds statistics per athlete.

## Workflow

1. **Setup** — enter the two fencers' names (previously used names are
   suggested automatically) and pick the bout length (5 or 15 touches).
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
- full bout history

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

It's a static site — no build step:

```bash
# any static server works, e.g.
python3 -m http.server 8000
# then open http://localhost:8000
```

or simply open `index.html` in a browser, or host the repo on GitHub Pages.
Designed for tablets/phones (large touch targets, responsive layout) but works
on desktop too.
