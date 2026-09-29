# War Crime or Not

A public experiment in two parts.

1. **Head-to-head ranking.** Participants see two incidents from Gaza (Oct 2023 onward) and pick the more serious one. The votes feed an Elo ranking ([`lib/elo.js`](lib/elo.js)), which produces a crowd-sourced Top 25. Each incident card shows its evidence status, sources, the official Israeli response and international reactions. The reactions are scored by the **Condemn-o-meter** ([`lib/condemn.js`](lib/condemn.js)), which runs from "concerned" to "categorically condemns".
2. **Headline test.** Participants rate BBC headlines. Each person sees a random half of the headlines *before* the comparisons and the other half *after*. Comparing the two groups shows whether contact with the documented record changes how a headline reads.

## Run it

```sh
npm run serve     # static site, any static host works (GitHub Pages, Netlify, Cloudflare Pages)
npm test          # Elo engine tests
npm run e2e       # simulated visitor clicks through everything, records recordings/latest.mp4 (~12 s)
npm run e2e -- --runs=10   # same, 10 randomised runs, fails on any error
npm run build:data         # rebuild data/dataset.js from data/*.json
```

Votes stay in the visitor's browser unless you deploy the optional backend in [`worker/`](worker/README.md) and set `API_BASE` in `config.js`.

## Reusing the Elo engine

`lib/elo.js` has no dependencies and knows nothing about this project:

```js
import { EloPool, replay } from './lib/elo.js';

const pool = new EloPool(['a', 'b', 'c']);
pool.record('a', 'b', 1);          // a beat b (0 = b won, 0.5 = tie)
const [x, y] = pool.nextPair();    // most informative next match-up
pool.top(25);

// Recommended for crowd votes: store the log, rebuild from it,
// averaging over shuffled orders so vote timing doesn't matter.
const ranked = replay(ids, votes, { shuffles: 20 });
```

## Data

Incidents come from [warcrimes.planetarycouncil.org](https://warcrimes.planetarycouncil.org/) (`data/planetarycouncil.json`, copied from the `PlanetaryCouncil/warcrimes` repo), plus a few extra incidents, government reactions, BBC headlines and BBC context in `data/research.json`. `tools/build-data.mjs` merges them into `data/dataset.js`; evidence labels for the Planetary Council entries are set in that script. Visitors can also submit new incidents, which join the vote as `submitted` (unverified); one that climbs into the top 5 within a week takes the headline on the results page. Rules for editing the data:

- Every claim has a source link. Quotes are verbatim or clearly marked as paraphrase.
- `status` is `documented` (video, forensics, multiple independent investigations, or acknowledged by the IDF), `reported` (credible outlets or NGOs, not independently confirmed) or `alleged` (mainly testimony). A severe claim with weak evidence stays `alleged`. That protects the project: a single overstated item hands critics a reason to dismiss all the others.
- Headlines are included because someone publicly criticised their framing, from either direction. Each one links to that criticism.

## Before launch

`data/dataset.js` was compiled from search-result extracts, because the research tooling couldn't open most source pages (including every BBC page). Until someone checks each item by hand, `SOURCES_CHECKED = false` and the site shows a "Draft, do not cite" banner. To clear it:

1. Open every source link. Confirm each quote word for word and each headline exactly as the BBC published it, and add a bbc.co.uk URL where one exists.
2. Resolve the open points in `researchNotes` at the bottom of the file, such as al-Nasr baby numbers and Hind Rajab's age.
3. Set `SOURCES_CHECKED = true`.
