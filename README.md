# Flinch

**Don't flinch.** A reaction duel on a shooting range: wait for the buzzer,
find the card, one shot, five rounds. Fire early and you flinched; wait too
long and Lane 8 takes the round. He gets faster every level you beat.

The code, the folder and the save key still carry the codename *Lane 7* —
your own lane. The rival is Lane 8. The game is Flinch.

Browser, portrait, one hand. Plain JavaScript and Canvas 2D with a small
in-house engine layer. No build step, no dependencies at runtime, works
offline once loaded, installs to a phone home screen.

## Play

- Live: <https://zarah-ai-team.github.io/flinch/> — add it to your phone's
  home screen and it works offline.
- Local: open `lane7/index.html` in a browser, or run `npm run serve` and
  open <http://localhost:8080>.
- `?q=max` pins full resolution, `?q=low` starts at 1× for old phones.

## Rules

| Outcome | You | Lane 8 |
|---|---|---|
| Head hit | 5 | 0 |
| Body hit | 3 | 0 |
| Paper, miss, white NO-SHOOT card, too slow, or fired early | 0 | 3 |

Two heads beat three losses. Two bodies don't. That's the whole reason
to aim at the small circle.

Ten levels: Lane 8 gets faster, the carrier roams further, the bay gets
darker, white no-shoot cards appear. Cleared levels can be replayed from
the title. The daily challenge is one attempt per UTC day on the same
range for everyone; win on consecutive days for a streak.

## Develop

```
npm test                 # rules tests, no browser, prints the difficulty curve
npm run test:browser     # Playwright smoke test with screenshots (npm i && npx playwright install chromium first)
npm run serve            # http://localhost:8080
npm run icons            # regenerate lane7/icons/*.png from the card geometry
```

Read `GDD.md` (design) and `TECH.md` (architecture) before changing
anything non-trivial; `CLAUDE.md` carries the working rules for Claude
Code. The rules live in `lane7/src/sim.js` and never touch the DOM; the
level table is the only place difficulty is defined (`lane7/src/config.js`).

## Deploy

`.github/workflows/deploy-pages.yml` runs the rules tests and publishes
the game to GitHub Pages on every push to `main`. Enable it once under
repo Settings → Pages → Source: GitHub Actions. For itch.io, zip the
contents of `lane7/` (without `test/`) with `index.html` at the root and
upload as an HTML project.

## Licence notes

Fonts: Barlow and Barlow Condensed by Jeremy Tribby, SIL Open Font
License 1.1, self-hosted in `lane7/fonts/`. Everything else is drawn or
synthesised in code.
