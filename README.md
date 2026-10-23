# JEV ARENA — Robot Boxing Championship

JEV ARENA is a local AI-vs-AI robot boxing game. Each boxer is named after its model with its personality in parentheses, for example `JEV (BERSERKER)` or `CLAUDE (COUNTERPUNCHER)`. Two autonomous humanoid robots box in a 3D championship ring: they jab, cross, hook and uppercut, guard, slip, counter, circle and fall. The server is authoritative; React Three Fiber renders the fight; React exposes live decisions and match telemetry. Each robot's tactics come from an AI provider (Jev, OpenAI or Claude) or from an explicitly labelled local Demo bot.

## Windows quick start

Use Node.js **22.18+** and npm. In PowerShell, from this folder:

```powershell
npm install
Copy-Item .env.example .env
```

Put your credentials in the root `.env` (never in a `VITE_` variable):

```dotenv
TYPESAFE_API_KEY=your-key-here
OPENAI_API_KEY=optional
ANTHROPIC_API_KEY=optional
```

Start the client and backend:

```powershell
npm run dev
```

Open http://127.0.0.1:5173. If PowerShell blocks `npm.ps1`, use `npm.cmd` instead. The backend binds to `127.0.0.1:3001`; credentials stay server-side and are ignored by Git.

Choose **Live providers** for real independent decisions, or **Demo Mode** for an explicitly local rule-based bot that makes no API calls. A missing or failed real API request is shown as an error and never silently falls back to Demo Mode.

## The 3D ring

- **Robots.** Two articulated humanoid boxers built from primitives (head, neck, torso, shoulders, two-segment arms, gloves, hips, thighs, shins, boots). Animation is a procedural rig: two-bone inverse kinematics drives arms and legs, while the torso twists, leans, slips and crouches. RAVAGER (red) is dark armour with red neon; AEGIS (blue) is silver and dark-blue armour with electric-blue neon. The look is cosmetic only — both start with identical stats.
- **Punches.** Gloves travel to where the opponent's head actually is. A jab leads with the lead hand, a cross twists the hips, a hook arcs around the guard, an uppercut dips and rises. The punch outcome comes from the server's event log: a clean hit snaps the head back (differently for jab, hook and uppercut), a blocked punch lands on the gloves, a slipped punch passes the moved head, a miss whiffs past it.
- **Reactions.** Hit-stop on heavy blows, slow motion and a push-in on knockdowns, impact sparks, floating damage numbers, camera shake, and a bloom glow on the neon. A knocked-down boxer falls to the canvas and rises for the next exchange; a stopped boxer stays down while the winner raises both gloves.
- **Referee and count.** A referee robot stands off to the side, closes in on a fallen boxer and counts (1–4 over a knockdown, 1–10 over a knockout; no count for a TKO or a decision). A replay button plays the last exchange again in slow motion.
- **Sound.** Punch thuds, whooshes, guard slaps, the bell, the count and a crowd that swells with the action, all synthesised in the browser with WebAudio (no audio files). It starts on your first click and has an on/off toggle.
- **HUD.** A fight-card introduction, "FIGHT!" at the opening bell, each round's score card at the bell, a round-momentum gauge, live landed/thrown punch statistics and a COMBO badge.
- **Moving like a boxer.** Feet are planted in the world, not glued to the body: a foot stays put until the body has drifted, lunged or been pushed too far, then it lifts, swings in a small arc and plants again, one foot at a time, so the boxers shuffle and step instead of sliding. A punch starts from the ground up: the hips turn first, the shoulders a moment later, the arm last, the rear foot pivots, and the fist turns over as it extends. The non-punching hand stays at the chin. A tired boxer's guard sinks and his breathing deepens; a badly hurt one wobbles. Each personality carries itself differently (pressure fighters lean in, counter-punchers stand tall with high hands and weave, the trickster bounces with low hands, the coward crouches covered); this is cosmetic and never changes the rules.
- **Smooth motion.** Every joint value follows a critically damped spring (velocity carries from frame to frame), punches accelerate in, hold for an instant and snap back, and exchanges that arrive faster than they can play are queued and played in order rather than cut short. Quality adapts to the machine: if the frame rate cannot be held, shadows, bloom and high pixel density switch off.
- **Cameras.** Broadcast (follows the circling fight line), over-the-shoulder from either corner, orbit, and free (mouse). `prefers-reduced-motion` turns camera shake off.
- **Assets.** There are no external model or texture files: everything is procedural, so there is nothing to license or download. The 3D scene is loaded on demand, so the first paint stays light.

## Boxing rules

A bout is boxed in **rounds of 12 exchanges** (the default of 36 exchanges is 3 rounds). Robots begin in realistic punching range. Each exchange is chosen concurrently from one frozen state snapshot.

| Action | Stamina | Effect |
| --- | ---: | --- |
| JAB | 7 | Fast, accurate low-damage punch |
| CROSS | 13 | Medium straight punch with a short cooldown |
| HOOK | 20 | Heavy close punch with knockdown potential |
| UPPERCUT | 28 | High damage, high knockdown chance, longer cooldown |
| GUARD | 0 | Reduces incoming punch damage |
| SLIP | 9 | Attempts a seeded evasive head movement |
| COUNTER | 15 | Punishes an opponent who chooses a punch |
| STEP IN / STEP BACK | 2 / 3 | Footwork. Stepping back pulls hooks and uppercuts out of range |
| CLINCH | 2 | Tie the opponent up at close range: no punching, +14 stamina, and their punches are smothered (about a third less accurate, reduced like a guard) |

- **Health.** 170 per boxer. Stamina regenerates every exchange.
- **Fatigue.** Below 25 stamina a boxer is gassed: punches are 20% weaker and less accurate.
- **Rounds and rest.** After each round both corners recover 35 stamina and 6 health, cooldowns clear and the referee resets the distance.
- **Three judges.** Each round is scored by three judges who weigh the same fight a little differently (damage, activity, defence), as real judges do. The bout is decided by their majority: *unanimous*, *majority* or *split decision* (for example `AEGIS (COUNTERPUNCHER) 29–28, 29–28, 28–29`). If the judges cannot separate the boxers, the consensus card and then total scoring decide.
- **Clinching and fouls.** A clinch recovers stamina but earns the clincher no defensive credit. A second clinch in a row draws a referee warning; a third costs a point on every judge's card for that round.
- **Cards.** Each round is scored 10–9 from damage, clean punches, knockdowns, counters, guards and slips; 10–8 when dominant; 10–10 when level. A punch caught on the guard earns the attacker only its reduced damage, so attacking into a guard does not out-score good defence. Weights are in `RULES` (`judge…`).
- **Combinations.** A punch that lands cleanly makes natural follow-ups more accurate (+10 points) and harder-hitting (+10%) in the next exchange: jab → cross or hook, cross → hook or uppercut, hook → cross or uppercut, uppercut → jab or hook. The bonus expires after one exchange. Both corners use the same table, and the AI is told which follow-ups are live.
- **Knockdowns and the count.** A knockdown stuns (the boxer is more vulnerable afterwards) but the count gives some rest (+12 stamina). Three knockdowns is a TKO.
- **Finish.** KO at zero health, TKO, or the judges' cards. Level cards fall back to total scoring, then at most six sudden-death exchanges, then a landed-punch/damage/defense tie-break; an exact tie is a rare draw.
- Three exchanges without a clean punch cause a neutral referee reset — no damage and no hidden advantage.

Every provider receives the same instructions, the same state snapshot and the same legal-action descriptions: the fighter personality, health, stamina, cooldowns, knockdowns, distance, opponent history, round and cards, and only currently legal actions. Red defaults to **BERSERKER** pressure boxing and Blue to **COUNTERPUNCHER** tactics; base stats are equal. The UI never invents probabilities: it shows a distribution only when Jev returned one. OpenAI uses a strict JSON schema and Claude a forced tool call, so neither can answer outside the legal set.

## Judged on the same base

The aim is that the **only** differences between the corners are the personality and the AI model. This is enforced and checked, not assumed:

- **Same rules, same numbers.** One rules table and one set of base stats for both corners; the client cannot change them. Visual differences (armour, colours) are cosmetic.
- **A corner-independent prompt.** The AI never sees raw coordinates, names or colours, so it cannot tell which corner it is in. Positions are given as distances to the opponent and to the ropes. Every provider gets the identical text; only the personality paragraph differs.
- **Shared dice.** Both corners read one dice stream keyed by seed and exchange, never by corner, so a seed cannot be luckier for one side: two boxers making the same choices get the same luck. Tournaments also swap corners every other bout.
- **A fairness audit** (panel under the ring, `POST /api/fairness`). It checks identical base stats, a mirror-image start, that the prompt is identical from either corner across ~400 sampled fight states (the bout is mirrored and the prompts compared), identical legal actions, no names in the prompt, and dice balance. It was verified to fail when a corner leak is deliberately reintroduced.
- **A test-type label** that says what your setup can attribute a result to: *model-only* (same personality, different model), *personality-only* (same model, different personality), *mixed* (both differ: a winner cannot be credited to either) or *identical* (any gap is luck). The "Same personality" and "Same model" buttons set up a clean one-factor test in one click, and tournaments carry the label into their saved logs.

Provider transport is the one thing that cannot be identical: each provider receives the same text through its own API (Jev choice question, OpenAI strict JSON, Claude forced tool call) at that provider's default sampling. That is treated as part of what "the model" means.

## Fighting styles, and how a rule-based bot and an LLM share the same base

**In real boxing.** A *pressure fighter* or swarmer (the game's BERSERKER: think Joe Frazier, or Mike Tyson in his prime) walks forward, cuts off the ring and throws combinations to the head and body, accepting punches to land more. A *counter-puncher* (COUNTERPUNCHER: Pernell Whitaker, Floyd Mayweather Jr., Juan Manuel Márquez) lets the other boxer come, slips or blocks, then answers while the opponent is open. Pressure wins by volume and damage; counter-punching wins by accuracy and by making the other side miss and tire.

**In the game.** The two are not different bodies: same health, stamina, speed, rules and dice. What differs is the *decision*:

- **An LLM** receives the identical state and the identical list of legal actions as everyone else, plus one paragraph describing its personality (`PERSONALITY_PROMPTS`). It decides by reading that paragraph.
- **The local rule-based bot** is a *decision model*: for every legal action it computes a utility (expected damage swing minus stamina cost), then picks by weighted chance. A personality is a set of numeric temperament weights (aggression, defence, stamina care, counter bias, randomness). BERSERKER weighs attack high and defence low; COUNTERPUNCHER weighs counters and slips high and attacks lower.

Both see the same information (their own and the opponent's health, stamina, cooldowns, recent actions, distance, round cards and the legal actions) and are judged by the same engine, so they can be put in the same ring: choose **LOCAL BOT (rule-based baseline)** as a fighter's brain, or include it in the lab as a contender. That makes the rule-based bot the baseline every model is measured against (does Claude beat a transparent expected-value heuristic with the same personality?). They are not the same *kind* of brain, and the game does not pretend otherwise: the bot has no model probabilities and never answers illegally; an LLM reads text and sometimes does.

## Decisions, side by side

The panel under the ring (**Both decisions, side by side**) shows both boxers at once: the chosen action, the probability table when the provider returned one, response time, model id, number of legal actions and any illegal-move fault. The ring HUD also prints each boxer's choice (`CHOSE JAB 72%`) under its name, so both minds are visible while you watch, including when you watch a simulation.

## Making the arena yours

- **Posters.** Six posters of Muhammad Ali and Mike Tyson hang around the hall. No photos ship with the game; put your own images in `client/public/arena/` as `ali.jpg` and `tyson.jpg` (`.jpeg`, `.png` and `.webp` also work, and so do capitalised names such as `Ali.jpeg`) and refresh. Portrait photos are cropped from the top so faces stay in frame. The **HALL** camera pans across the posters and the LED wall. Until then each poster shows a plaque with the boxer's name, nickname and record.
- **Lighting and mood.** The hall is dark and only the ring is lit: a hard key light over the canvas with a shadowless fill, red and blue back-lights that separate each boxer from the dark, volumetric light shafts (four on the ring, two on the corners, three moving heads sweeping the crowd and homing in on the ring at the finish), and haze. The house lights dim on a knockdown and drop low on a knockout, with a slow pulse (nothing strobes). The picture is graded in post (bloom, subtle chromatic aberration, ACES tone mapping, film grain, vignette). The crowd is a silhouette audience on raked tiers with aisles: camera flashes at each seat's own rhythm, phones held up, arms rising when the crowd is on its feet. Walls, roof, a lamp truss, LED ribbons and exit signs complete the hall. On a slow machine the shadows, bloom and grading switch off automatically.
- **The hall.** An LED wall behind the ring shows the fight live (names, health, round, cards), ringside advertising boards, the three judges at their table, haze in the spotlights, and the crowd.
- **The project credit** at the top of the page, on the LED wall and in the browser tab comes from `client/src/project.ts`.

## Illegal moves never stop a fight

If a model answers with something unusable (an action that is not legal right now, malformed JSON, a bad probability table), the bout carries on: the referee makes that boxer **guard for the exchange**, the fault is shown in the ring log (`ILLEGAL MOVE: … answered "FLY"`), flagged on the decision panels, and counted. The count appears per fighter in tournament results and in the grid leaderboard (an illegal-move rate is a real measure of a model). Real failures — no network, a bad key, a rate limit — still stop the match with a Retry, because nothing was decided; in simulations they are retried twice first. This is a penalty, not a substitute brain: a model is never replaced by a scripted bot.

## Watching a simulation

Tick **Watch every fight** on the head-to-head tournament or in the lab and the simulation plays out in the 3D ring, one bout at a time and in order: the fight card, every exchange, the count and the result, then the next bout (corners swap between them). A bar under the ring shows which bout is on (`BOUT 7 / 40: JEV (BERSERKER) (red) vs CLAUDE (COWARD) (blue)`) and lets you change the speed while it runs (1× to 8×, or fast-forward, which paces the simulation at about 15 ms per exchange). The decision panels, log and cards follow the bout on show. Stop watching at any time; the simulation keeps running and its results still arrive. With parallel live bouts the first one is shown. Unwatched simulations run at full speed.

## What the seed does

The **seed fixes the dice**: whether each punch lands, is slipped, or knocks the opponent down. Both corners read the same dice, so two boxers making the same choices get the same luck, and the same seed with the same decisions replays the identical fight.

It **does not choose what the AI does**. Model decisions are not seeded, so a live fight can change between runs even with the same seed (only the local Demo bots draw small variations from it). Use the 🎲 button for fresh dice, or keep a seed to compare setups on identical luck.

## Tournament lab (grid search)

The lab under the ring crosses **every model with every personality** and boxes every contender against every other, round-robin. Contenders are named `MODEL (PERSONALITY)`.

- **Design.** Bouts are scheduled round by round (bout 1 of every pairing, then bout 2, and so on), so stopping early still leaves a balanced result. Bout *k* of every pairing uses seed `base + ⌊k/2⌋`, once with each corner assignment, so a pairing is judged on identical luck from both corners and all contenders face the same sequence of luck. Optional mirror matches (a contender against itself) measure pure luck.
- **Cost, before you commit.** It shows contenders, pairings, bouts and the maximum and expected number of paid API calls, with a time estimate. Live grids need an explicit confirmation, a server key for each model, and are capped (3,000 bouts, 40,000 paid calls). A provider hiccup (HTTP 502) is retried twice before a bout is abandoned; cancelling aborts requests in flight, and a failed or cancelled grid still saves the bouts it finished.
- **Results.** A leaderboard with 95% confidence intervals, a head-to-head heat map (click a cell to load that fight into the ring), and two *controlled* effects: the **model effect** uses only bouts where the personality is equal, and the **personality effect** only bouts where the model is equal, so each isolates a single factor. A verdict says which matters more. Download the standings as CSV; the full per-bout log goes to `results/`.
- Run `npm run balance:matrix` to see how the shipped Demo bots behave across the same grid (no API calls).

## Running a fair experiment

Write the question first, for example "does Claude beat GPT with the same personality?". Then:

1. Give both sides the **same personality**, so the model is the only thing that differs.
2. Use **Tournament** with *swap corners* on, so a corner advantage cannot decide the result. Contender A starts in the red corner and the two swap places every other bout.
3. Read each contender's win rate with its 95% confidence interval. With fewer than 30 bouts the interval is wide: a gap inside it is a tie, not a ranking.
4. Every tournament writes a per-bout log (setup, cards, every decision with provider, model and latency) to `results/`, and every finished match too. Download any fight as JSON from the results dialog. Tournaments can be cancelled, which aborts requests that are still in flight.

LLM decisions are not seeded, so only the dice are reproducible: re-running a seed replays the same luck, not the same choices.

## Verification

```powershell
npm run check              # tests, then the full build
npm test                   # Vitest
npm run test:offline       # dependency-free boxing regression suite
npm run benchmark:boxing   # 100 local Demo Mode matches; no API calls
npm run balance:matrix     # every personality vs every personality, both corners; no API calls
npm run balance:policies   # LLM-like aggressive / passive / counter-punching policies under the current scoring; no API calls
npm run build              # TypeScript + Vite + server build
```

`balance:matrix` reports the corner bias (red's win rate overall and in mirror matches), each style's win rate, finish mix, average length and footwork share. With the shipped rules it lands near 50% corner bias, styles between about 40% and 60%, and a mix of knockouts (about two thirds), TKOs and decisions averaging about 30 exchanges. Re-run it after any rule change.

For a deliberate paid credential check only:

```powershell
npm run smoke:live -- --confirm-paid-api
```

It sends two independent legal requests from the same snapshot. Automated tests mock provider responses and do not spend credits.

## Architecture

- `shared/`: boxing types, actions, personalities and balance constants
- `server/src/game/`: deterministic simultaneous resolution, rounds, combinations and scoring; `fairness.ts` is the fairness audit
- `server/src/ai/`: Jev, OpenAI and Claude request construction, response validation and the Demo bot
- `server/src/matchManager.ts`: in-memory authoritative sessions, duplicate-turn protection, tournaments
- `server/src/recorder.ts`: JSON fight logs in `results/`
- `client/src/game/rig/`: the animation core — event log to per-boxer beats (`beats.ts`), pose and choreography (`rig.ts`), two-bone IK (`ik.ts`); pure TypeScript, unit-tested without a GPU
- `client/src/game/`: the React Three Fiber scene — boxers, referee, ring, crowd, effects, camera director, HUD and `sound.ts`
- `client/src/components/`: spectator controls, decision inspector, tournament and results
