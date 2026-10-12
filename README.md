# civil-war

civil warrrrr

The scoreboard for our Team Cap vs. Team Stark game. It runs as a Cloudflare Worker: the pages are static files in `public/`, the API lives in `src/index.ts`, and the kills sit in a D1 database.

Characters are the fixed points of the game. From `/admin` you can change who plays each one, which team it fights for, its nemesis and its special. Every kill copies the player, character, team and points at the moment it is logged, so remapping later never moves points that were already scored. Team totals follow the team the killer was on at the time; the standings follow the character.

## Running it

```sh
bun install
bunx wrangler d1 create civil-war     # paste the id into wrangler.jsonc
bun run db:migrate                    # local database, seeded with the cast
printf 'ADMIN_PASSWORD=...\nPLAYER_PASSWORD=...\n' > .dev.vars
bun run dev
```

To ship it:

```sh
bunx wrangler secret put ADMIN_PASSWORD
bunx wrangler secret put PLAYER_PASSWORD   # optional
bun run deploy
```

`ADMIN_PASSWORD` turns on `/admin`; without it the admin page stays locked. `PLAYER_PASSWORD` is optional. When it is set, logging or undoing a kill asks for it once per device; when it isn't, anyone with the link can log kills. Changing either password signs everyone out.

`bun test` runs the API against a throwaway local D1, and `bun run check` typechecks.

The canonical repo for this is hosted on tangled over at [`https://tangled.org/dunkirk.sh/civil-war`](https://tangled.org/dunkirk.sh/civil-war)

<p align="center">
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/main/.github/images/line-break.svg" />
</p>

<p align="center">
    <i><code>&copy; 2026-present <a href="https://dunkirk.sh">Kieran Klukas</a></code></i>
</p>

<p align="center">
    <a href="https://tangled.org/dunkirk.sh/civil-war/blob/main/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=MIT&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>
