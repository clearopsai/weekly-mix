# Weekly Mix

A daily AI puzzle. One a day. No accounts. No ads. No tokens.

This is the MVP from the pinned concept at
`/opt/jarvis/rcd/underground_research/pinned_concepts.md` (CONCEPT 001).

## What it is

A Wordle-style daily guessing game where the player tries to reverse-engineer
an AI-generated prompt from its output. Six guesses. Synonym-aware matching.
Shareable emoji result grid. Streak tracking in localStorage.

The modality rotates by day-of-week so that each day uses a different part
of the operator's AI stack:

| Day | Modality | Tool |
|---|---|---|
| Mon | image prompt | Midjourney / Flux |
| Tue | voice id | ElevenLabs |
| Wed | sound id | Suno / Riffusion |
| Thu | motion clip | Runway |
| Fri | story trap | Claude / local |
| Sat | vibe mix | combined |
| Sun | mega mix | all of the above |

MVP ships with image-prompt guessing only. Other modalities currently fall
back to image until the per-modality UIs are built.

## How the game works

1. Page loads today's puzzle from `./puzzles/YYYY-MM-DD.json` (UTC date).
2. An AI-generated image is displayed with a row of blank slots, one per
   target word from the prompt.
3. Player types a word or phrase. Each word in the guess is normalized and
   compared against the remaining target words via loose matching + a
   synonym map (global + per-puzzle).
4. Hits reveal slots. Misses don't. Six guesses total.
5. Win = all slots revealed. Result is a shareable emoji grid.

## Run locally

No build step. Just serve the directory:

```bash
cd ~/weekly-mix
python3 -m http.server 8790
open http://127.0.0.1:8790/
```

## Deploy

Any static host. Cloudflare Pages, Vercel, GitHub Pages, Netlify. The whole
app is `index.html`, `style.css`, `app.js`, and the `puzzles/` directory.

Pick a domain (`weeklymix.app` is referenced in the emoji grid footer; if
you register a different one, update the string in `app.js`
inside `buildEmojiGrid()`).

## Add a new daily puzzle

Create `puzzles/YYYY-MM-DD.json` with this shape:

```json
{
  "date": "2026-04-16",
  "modality": "image",
  "image": "https://example.com/your-image.jpg",
  "prompt": "the full prompt used to generate the image",
  "targets": ["five", "to", "seven", "key", "words"],
  "synonyms": {
    "five": ["5", "quintet"],
    "key": ["important", "main"]
  }
}
```

- `targets` should be 5-7 meaningful words from the prompt. Not "the", "a",
  "with", "of". Nouns, adjectives, and distinctive verbs.
- `synonyms` is optional but greatly improves the UX. For each target that
  has obvious near-synonyms, list them. Plurals and -ing forms are handled
  automatically by the matcher.
- `image` should be a 1:1 or roughly square image. Unsplash works fine for
  prototyping. Swap in Midjourney / Flux exports for production puzzles.

## Puzzle generation ideas

For the actual rollout, puzzles should be generated rather than hand-crafted.
One path:

1. Run a Midjourney or Flux generation with a logged prompt.
2. Extract 5-7 target words from the prompt using `jarvis-arena` or Claude,
   asking for "the most distinctive concrete nouns, adjectives, and styles
   in this prompt that a player could reasonably guess from the image."
3. Generate a synonyms block for each target via a second API call.
4. Write the resulting JSON to `puzzles/YYYY-MM-DD.json`.
5. Commit and deploy.

Alternatively, a nightly cron on the JARVIS box can do this end-to-end
using the local model + an image-generation endpoint of choice.

## Monetization path (post-viral)

From the pinned concept doc:
1. Ride free, organic growth until acquisition offer lands (Wordle model)
2. Premium $2.99/mo for analytics, leagues, custom modes
3. Daily sponsored puzzle once 100k+ DAU
4. White-label to education, ESL, museums, libraries
5. Telegram MiniApp distribution with Telegram Stars for per-hint unlocks
   (architecture surfaced by the underground research run on 2026-04-11,
   see the COVEAI finding in pinned_concepts.md and the underground
   research fact sheet `ug_20260411_195650_*.md`)

## Known limitations of the MVP

- Matching is keyword-based, not semantic. "large body of water" will not
  match "ocean" unless you add the synonym. This is fine for MVP because
  puzzles are handcrafted, but for scale you want a semantic embeddings
  model (local or OpenAI) scoring guesses against targets.
- Only the image modality is implemented. Voice / sound / motion / story
  modalities need their own input UI.
- No server-side puzzle generation. All puzzles are static JSON files.
- No leaderboard. No account system. This is deliberate for the MVP but is
  where premium tier would live.
- `weeklymix.app` is an unowned placeholder domain in the share grid footer.
  Either register it or update the string.

## Files

```
weekly-mix/
├── index.html          page skeleton, 1 file, zero deps
├── style.css           terminal-meets-daily-game aesthetic
├── app.js              game logic, loads puzzle JSON, manages state
├── README.md           this file
└── puzzles/
    ├── fallback.json   used when today's puzzle file is missing
    ├── 2026-04-13.json Monday launch puzzle
    ├── 2026-04-14.json Tuesday
    └── 2026-04-15.json Wednesday
```

## Tests

```bash
python3 /tmp/test_weekly_mix.py
```

The Playwright test covers: puzzle loads, guess input, synonym matching,
state persistence across reload, win state, emoji grid generation, share
and reveal buttons. As of 2026-04-11 it passes end-to-end against the
fallback puzzle.
