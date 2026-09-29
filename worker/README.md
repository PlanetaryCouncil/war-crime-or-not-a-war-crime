# Shared vote backend (optional)

Without this, votes stay in each visitor's browser. With it, everyone feeds one ranking.

```sh
npm i -g wrangler
wrangler d1 create wcnwc
# copy the database_id it prints into wrangler.toml
wrangler d1 execute wcnwc --remote --file=schema.sql
wrangler secret put SALT          # any random string
wrangler deploy
```

Then set `API_BASE` in `../config.js` to the worker URL.

`wrangler.toml`:

```toml
name = "wcnwc"
main = "index.js"
compatibility_date = "2026-09-01"

[[d1_databases]]
binding = "DB"
database_name = "wcnwc"
database_id = "PASTE-ID-HERE"

[vars]
ALLOWED_ORIGIN = "https://your-site.example"
```

Known gaps before a public launch: no rate limiting (add a Cloudflare rate-limit rule on `/api/events`), and `GET` returns the whole log, which is fine up to roughly 100k events.
