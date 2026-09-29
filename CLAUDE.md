# Working agreement

## How to report work (owner preference)

The owner does not want to read code or follow GitHub links to judge progress.
After every change that affects what a visitor sees or does:

1. Run the simulated visitor: `npm run e2e` (see `tests/e2e/visitor.mjs`).
   It clicks through the site like a person, fails on console errors or broken
   flows, and records a ~12 s video to `recordings/latest.mp4`.
2. Send that video to the owner (`recordings/latest.mp4` via SendUserFile, display "render") with a one-line
   caption saying what changed and whether the run passed.
3. Keep the chat summary short: what they'll see in the video, what's broken,
   what decision is theirs. No code walkthroughs unless asked.

## Project rules

- Facts: every incident and quote needs a source link; label evidence
  `documented` / `reported` / `alleged` honestly. Never invent quotes.
- Community submissions are shown as `submitted` (unverified) until reviewed.
- Allegations about named people are stated only as attributed allegations,
  with any denial alongside (UK defamation law applies — the owner is in London).
- `npm test` must pass (Elo engine unit tests).
