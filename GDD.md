# Flinch — Game Design Document

**Status:** v2.1 build playable in browser (`lane7/index.html`). Random carrier
placement, 5 rounds, 10 levels, no-shoot cards and the full feel pass are in
(v2). v2.1 adds the level select, per-level bests, the daily challenge, share,
the shooter's pistol and installs to a phone home screen. v2.2 follows the
first phone test: every level is harder, movers arrive at level 6, the hit
is rebuilt and the renderer is cut down for phone GPUs.
**Target:** iOS App Store, portrait, one hand, free with no ads until proven.
**Last updated:** 11 Sep 2026 (v2.2). v1 and v2 notes preserved where still true.

---

## Name

**Flinch.** One word, and it is the rule that costs most rounds: fire before
green and you flinched; hesitate and Lane 8 has you. Tagline: *Don't flinch.
One shot, five rounds.* The project's codename stays **Lane 7** — the lane
you are standing in, stencilled on the back wall — and the rival stays
**Lane 8**. Folder, namespace and save key keep the codename so nothing on a
player's phone breaks. Decided 11 Sep 2026. The repo is
github.com/zarah-ai-team/flinch; its first slug, rooter-shooter, was dropped
because "rooter" is crude slang in Australia and New Zealand.

## One line

A reaction duel on a shooting range: find the card, one shot, five rounds —
and Lane 8 gets faster every level you beat.

## Core loop

1. **Arm.** The carrier motor whirs and the card slides to a spot you don't
   know yet. Early levels let you watch it park; later ones happen in the dark.
2. **Hold.** Red lane light. Wait. Any tap now is a false start.
3. **Fire.** Buzzer, green light, and the lamp over the card snaps on as the
   card turns face-on. You have exactly one shot. Tap where you want it.
4. **Verdict.** The round resolves, the reaction time rolls up. Tap to skip.
5. Five rounds, then a level verdict: win and the next level unlocks.

A round is roughly five seconds. A level is under thirty. Ten levels is a
commute, and every one of them is a fresh set of positions. The title screen
is the hub: the next level, every level already cleared, and today's daily.

## What the game is now about

v1 was pure timing: the target was always in the same place, so the only
question was *when*. v2 asks three questions at once, and the level table
turns each one up on its own dial:

- **When** — Lane 8's reaction time falls from ~855 ms at level 1 to
  ~440 ms at level 10. The floor is 400 ms; a located tap under that is
  rare enough on a phone that a level is never unwinnable, only brutal.
- **Where** — the carrier stops at a random depth and lateral position.
  Near targets are big and low on screen, far ones small and high. Level 1
  barely moves it; level 10 uses the whole bay.
- **What you can see** — the bay gets darker while you wait (by level 7 you
  see nothing until the lamp), the lamp itself gets dimmer, and from level 3
  white NO-SHOOT cards hang beside the target with their own lamps. The
  buzzer tells you *now*; the lamp tells you *roughly where*; you still have
  to pick the manila card out and hit it.
- **Whether it holds still** (v2.2) — from level 6 the carrier is a mover:
  the card slides sideways the moment it turns, faster every level, and
  bounces off the lane edge. You aim at where it is, not where it parked.

## Rules

| Outcome | You | Lane 8 |
|---|---|---|
| Head hit | 5 | 0 |
| Body hit | 3 | 0 |
| Card margin (paper, outside the silhouette) | 0 | 3 |
| Miss the card | 0 | 3 |
| Hit a white NO-SHOOT card | 0 | 3 |
| Lane 8 fires first | 0 | 3 |
| Fire before green (during arm or hold) | 0 | 3 |

Lane 8 always takes the body. He never gambles, never misses, never fires
early. He is a clock with a gun.

## Scoring arithmetic (corrected from v1)

v1 claimed that safe play against a safe opponent produces a draw. It does
not, and never did: Lane 8 only scores in rounds *you* fail, so the two of
you never score in the same round. With `h` heads and `b` bodies over five
rounds, a draw needs `5h + 3b = 3(5 − h − b)`, i.e. `8h + 6b = 15` — no
integer solution. **A match cannot end level.** The code still handles a tie
defensively, but the design never produces one.

What the head is actually for is the comeback. Lose three rounds and Lane 8
has 9; two bodies give you 6 and the match, two heads give you 10 and the
win. Two heads beat three losses. Two bodies don't. That's the whole reason
to ever aim at a 43-point circle instead of a torso, and it bites hardest
when you are behind, tired, and the card is small.

If playtesting shows nobody ever goes for the head, widen the gap (head 6,
body 2) before adding anything.

## Levels

Every number below lives in `CONFIG.levels`; the game reads nothing else to
decide difficulty. `opp` is Lane 8's reaction lerped from round 1 to round 5,
±80 ms jitter, floored at 420.

| Lv | Name | Lane 8 (ms) | Hold wait (ms) | Depth | Spread | Light while waiting | Lamp | Decoys | Mover (px/s) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Warm-up | 900→810 | 1000–2600 | near | 50% | full | 100% | 0 | 0 |
| 2 | Range hot | 840→750 | 1000–2800 | near | 70% | 80% | 100% | 0 | 0 |
| 3 | No-shoot | 780→700 | 900–3000 | near–mid | 85% | 60% | 95% | 1 | 0 |
| 4 | Lights low | 730→650 | 900–3200 | mid | 100% | 30% | 90% | 1 | 0 |
| 5 | Lights out | 680→600 | 800–3400 | mid | 100% | 5% | 85% | 1 | 0 |
| 6 | Movers | 630→560 | 800–3600 | mid–far | 100% | dark | 80% | 1 | 50 |
| 7 | Hostage bay | 590→520 | 700–3800 | mid–far | 100% | dark | 72% | 2 | 65 |
| 8 | Night bay | 550→490 | 700–4000 | far | 100% | dark | 64% | 2 | 80 |
| 9 | Hair trigger | 510→450 | 600–4300 | far | 100% | dark | 56% | 2 | 95 |
| 10 | Lane 8 | 470→410 | 600–4600 | far | 100% | dark | 48% | 2 | 110 |

The names are the tutorial. "No-shoot" is the level the white cards appear,
"Lights out" the level the bay goes dark, "Movers" the level the carrier
starts sliding. Nothing else explains them.

### Why v2.2 is harder

The first phone test said levels 1–5 were a formality and the same thing
five times over. They were: Lane 8 opened at ~1100 ms, which anyone under
~700 ms beat without looking, and nothing but his speed changed until
level 6. v2.2 starts him ~250 ms faster, moves the wall ~50 ms a level all
the way up, and turns a new dial every step: spread at 2, the first white
card at 3, the dark at 4–5, the mover at 6, the second card and the
distance at 7–8, the mover's speed and a dimmer lamp at 9–10, with Lane 8
on the 400 ms floor at the end. Level 10 wants a genuine ~440 ms located
tap on a card that is small, dim, moving and flanked. If nobody clears it
in a week, raise `opp` on levels 8–10 by 40 ms; don't touch the floor.

Win → next level unlocks (the title screen offers it). Lose → replay. Beat
level 10 → "Range master", and level 10 stays open as the ranked-ladder
placeholder.

### Level select and per-level bests (v2.1)

The title shows all ten levels as chips: cleared ones are open and show the
fastest hit ever recorded on that level, the next one is lit, the rest are
locked. Tapping anywhere still starts the next level; tapping a chip starts
that one. Replaying a cleared level counts as a match and can improve its
best time, but never moves the ladder back: the "next level" is the highest
you have earned. A record line under the chips carries matches played and
won, the all-time fastest hit and dailies won. The fastest hit stays the one
number the game leads with.

### Simulated difficulty curve

A headless player with a fixed reaction time, ±40 ms noise, 40% head
gambles, no search time (`node test/sim.test.js` prints this):

```
win rate %      L1   L2   L3   L4   L5   L6   L7   L8   L9  L10
  400 ms       100  100  100  100  100  100   96  100  100  100
  450 ms       100  100  100  100  100  100  100  100   75   42
  500 ms       100  100  100  100  100  100   96   71   13    4
  560 ms       100  100  100  100   96   92   54   13    4    0
  640 ms       100  100  100   96   63   38    4    0    0    0
  740 ms       100   92   88    8    0    0    0    0    0    0
```

Real thumbs have far more variance than ±40 ms, and the dark bay, the
decoys and the mover add search and tracking time the simulation doesn't
model (its player aims at the card's live position perfectly), so real
curves will be softer and shifted right. The shape is what matters: each
level moves the wall by roughly 50 ms, a 640 ms player stalls around level
5, a 560 ms player around level 7, and level 10 needs a genuine ~450 ms
located tap. That is the "very difficult" the brief asked for.

## Daily challenge (v2.1)

One run a day, the same for everyone. The day is the UTC date; the level
rotates through the table (day number mod 10, so ten consecutive days visit
every level once); the seed is a hash of the day. Because the rules draw
every random number for a round the moment the round begins, two players on
the same seed get the same five positions, the same hold waits and the same
Lane 8 reactions whatever they do — a false start on round 2 changes nothing
about round 3.

**One attempt.** The daily is marked taken the moment it starts. Finish it
and the title shows the result; reload mid-run and it shows "forfeited". The
whole point is that nobody has seen today's positions before, so there is no
retry and no practice mode on the daily seed. Win on consecutive days for a
streak; a loss or a skipped day resets it. The row on the title shows today's
level and name before you play, the result and streak after, and a countdown
to the next one. The daily never touches the ladder.

## Share (v2.1)

A button on the title ("Share your best") and on the level and daily result
cards. On a phone it opens the system share sheet; on a desktop browser it
copies the text and says so. The text is one line — what was cleared, the
score, the fastest hit, the streak — followed by the game's URL. It is the
screenshot of the reaction time, in words.

## Decoys (design addition — turn off with `decoys: 0`)

Pure "Lane 8 gets faster" scaling makes the top levels a wall of *too slow*.
The white NO-SHOOT card adds a second skill — identification — that a fast
but careless player fails and a careful one passes. It is straight out of
real turning-target ranges (hostage / no-shoot cards), so it costs no fiction.
Decoys roam the whole bay: one can hang in front of the target, partly
covering it, as long as the target's head stays clear — everywhere along
the path a mover will take before Lane 8 fires. Hitting a decoy is a lost
round, no worse; the punishment is the round, not a special penalty. Two
is the most the bay can hold beside a mover; a third fitted so rarely that
"three decoys" would have been a lie on the level card.

## Movers (v2.2)

From level 6 the carrier slides sideways while the card is exposed and
reverses at the lane edge, at a speed set per level. It starts moving the
instant the light goes green, so the spot you watched it park in (on the
lit levels) or the spot the lamp reveals (in the dark) is already wrong by
the time your thumb lands. That is the third skill after timing and
identification: tracking. It is straight out of real ranges — movers are
a standard qualification stage — so it costs no fiction, and it is the
reason the top levels can be hard without Lane 8 becoming impossible. The
mover's hum is panned to where the card is going; on headphones it is a
tell. Hit-testing reads the live position, so a shot lands exactly where
the card is drawn.

## Reaction feedback

Every hit shows its reaction time rolling up from zero, tagged Lightning
(<300 ms), Sharp (<420), Steady (<560) or Late. The best time is the number
the title screen leads with. It is the number players will screenshot; keep
it prominent and keep it honest.

**The hit itself** (v2.2): a streak from the muzzle to the impact for
three frames, a four-point flash star over an oversize hole that punches in
and settles, paper chips, a few bigger torn pieces that flutter, a puff of
paper dust, a ring on both head and body, and a "+5" or "+3" that rises
from the hole. All of it lands inside the hit-stop, so the freeze frame is
the loud one.

**A new best is a moment** (v2.1): a gold ring that outlives the hit, extra
sparks, a warm flash, the lamp jolting on its arm, a three-note chime a beat
after the shot, and a NEW BEST tag that pops under the banner. It happens at
most once per session on average, so it can afford to be loud.

## What is deliberately absent

- **Any second player.** Online multiplayer waits for a proven, shipped
  single-player game. Local hot-seat is the cheap version if we ever want it.
- **Movement, cover, reloading, weapons.** Each is a different game. Resist.
  The pistol at the bottom of the screen is a picture of the shot you already
  took, not a system: no ammo count, no reload, no swap.
- **Currency, unlocks, cosmetics.** Levels are the progression. Nothing else
  until the loop is proven fun on a phone in a queue.
- **A second deadline.** Real turning ranges expose the card for a fixed
  window; here Lane 8's shot *is* the deadline. Two clocks would muddy the one
  question the game asks.
- **A daily leaderboard.** The daily is the same range for everyone, which
  is what a leaderboard needs, but ranking needs a server and an honest
  clock. Share is the manual version until then.

## Open questions for playtesting

1. Does anyone go for the head when behind, or do they accept the loss?
2. Is the dark hold (levels 5+) tense or annoying? Watch faces, not scores.
3. Is the level-6 decoy a "wait, what?" moment or a "that's unfair" moment?
   The level name should carry it; if it doesn't, add one line to the card.
4. Level 10 at ~440 ms with a 110 px/s mover: is anyone beating it? If
   nobody does within a week, raise `opp` by 40 ms across levels 8–10 —
   don't touch the floor.
5. Does the 300 ms grace after a skipped banner feel right, or do people
   still tap into a false start?
6. Card sizes at far depth: head is ~29 pt across on a 390 pt phone. Fair, or
   a thumb lottery? Measure on a device before shrinking anything.
7. The daily: is one attempt right, and does forfeiting on a reload feel
   fair or harsh? A phone call mid-run restarts the round, not the daily —
   check that people notice the difference.
8. The pistol: does it read as your own hand at the bottom right, or as
   clutter on a small phone? It never overlaps a card or the status line;
   if it still bothers anyone, shrink `LOOK.gun.barrel` before removing it.
9. Do people replay cleared levels for a better time, or only push forward?
   If nobody replays, the per-level bests can go and the chips get simpler.
10. Movers: does a card that slides feel like a range or like a cheat? If it
    reads as unfair, slow the top speeds before removing them; the hum and
    the lamp moving with the trolley are the honesty cues.
11. Did v2.2 fix the phone lag? Check the quality governor's resolution cap
    after a few rounds; if it has stepped down, the phone is still short.

## Later, if the loop holds

Ranked reaction ladder on level 10, and a daily leaderboard once there is a
server to trust. Decoys that move too. A duel skin at the cost of a 17+
rating.

## Art direction

An indoor range bay at night, drawn entirely in code: a 2.5D corridor with a
vanishing point, overhead rails and beams, a rubber trap along the base of
the back wall, a painted firing line and the shooter's bench at the bottom of
the screen. The lane number is stencilled on the back wall.

The bay is dark. Light comes from four places only: the lamp on each
carrier (warm, pooling on the wall and floor, flickering on like a
fluorescent tube), the lane signal at the firing line (a red or green pool
that washes the whole frame green for a beat at GO), the shooter's own
muzzle flash, and a brief pop of light at the point of impact. Level
difficulty is literally a lighting change.

The lane signal is a two-bulb housing, red above green like a real range
signal, so the state reads by position as well as colour.

The shooter's pistol sits at the bottom right in a rear three-quarter view:
the slide tapers away toward the muzzle, the grip drops off the bottom edge.
It is a dark silhouette with a rim light that the lane signal tints red or
green; on a shot it kicks back and up, the slide cycles, smoke and brass
leave the port, and the muzzle flash lights the bench. It never covers a
card or the status line. Under reduced motion it does not recoil.

Cards hang from a clip on a wire under a trolley. They swing when hit, turn
with a snap that overshoots and settles, and keep their holes for the level.
Their shadow is cast in the card's own frame so it swings with them. The
target is a manila B-27-style card with a black silhouette, printed dashed
zones and point values, staples, and a footer line — the rules are on the
object. The decoy is a white card with a grey outline figure, a red NO-SHOOT
sash and a circle-slash: at a glance, "no dark mass" means don't.

On the title the range is idling: the parked card sways, the lamp shade
drifts in a draft, and every few seconds the old tube stutters.

Feel: trauma-based shake (squared, so bodies tap and heads land), a zoom
punch toward the hit, 70 ms hit-stop then 340 ms slow motion on a head, a
muzzle-to-impact streak, an impact flash and star, holes that punch in
oversize, paper chips and torn pieces, paper dust, sparks, an expanding
ring, a rising score, smoke and an ejected casing on every shot, dust
drifting in the lamp beams, vignette and a touch of grain. Short haptics on hits where the platform has them. Reduced-motion
users get none of the shake, recoil, slow motion or haptics and the same
information.

The app icon is the target card under its lamp with one hole in the head,
rendered from the game's own geometry (`npm run icons`). No image files are
hand-drawn and none should be commissioned until playtest question 1 has an
answer.

## Audio direction

Everything is synthesised at runtime; every cue is the brief for what to
record. The go signal is a real range buzzer (two rough voices a fifth apart,
chopped at 50 Hz). The carrier motor hums and whirs, panned to where the card
is going, and clacks when it stops — on headphones that pan is a real, subtle
tell. The lamp clicks and hums on. The shot is a noise crack plus a low thump,
followed a quarter second later by the casing tinking on the bench. A head hit
rings bright and metallic; a body hit lands dull; a no-shoot gets a two-beep
alarm; a new best adds three bright partials climbing, a beat after the hit.
Lane 8's shot is the same gun, panned hard right. Win, lose and level-up are
short triangle-wave arpeggios; title buttons click. A compressor on the
master bus stops the buzzer and the shot clipping when they overlap.
