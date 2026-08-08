# mariisnky — i-spy memory garden

A shared wall of memories. Leave one moment; it becomes a marble. Every time
somebody opens it, it comes back from a different handful of its own fragments,
and a little more of it is gone.

```bash
npm install
npm run seed     # optional: puts a few memories on the wall so it is not empty
npm start        # http://localhost:5173
```

No build step. Node 18+, Express, and vanilla ES modules.

---

## The two worlds

**The garden** is a page out of an i-spy book: paper white, marbles strewn
across it, nothing labelled. Sweeping the cursor over a marble plays that
memory's own recorded sound. It is public, flat, and a lot at once.

**Inside a memory** is the opposite: one dark sphere, one thing at a time, and
it is falling apart. Going from one to the other should feel like putting your
eye to a hole in the page.

---

## What happens to a contribution

1. It is **torn into components** the moment it arrives — image layers cut at
   the picture's own luminance percentiles, phrase fragments, video time
   portions, overlapping audio windows. This happens once, in the browser, at
   upload. Nothing is ever re-cut.
2. It is **read for emotion** by keyword-matching against five word lists. There
   is no model in this path, which is exactly why the interface can explain it
   in one sentence — and does, both before you contribute and in the "what is
   left" panel afterwards.
3. It is **given a marble colour** drawn from the marbles already on the wall.
4. Every **opening composes a new version** from a different subset of the
   components, with decay climbing ~4–8% each time. Roughly one opening in six,
   something long-absent returns at full clarity while everything around it
   stays faded.

---

## The collaborative audioscape

Ported from `memory-symphony` off React/Tone.js into plain Web Audio
(`public/js/audioscape.js`), with one deliberate change to how memories join.

The original added a **permanent looping layer** per memory, deduplicated by
instrument name. That meant the tenth memory mapping to "piano" was silent, and
nothing ever left — the soundscape only accumulated.

Here a memory's contribution is a **swell**: it fades in over ~2.4s, plays its
progression twice, fades out over ~4s, and disposes itself. Every contribution
is heard, contributions stack while they overlap, and nothing repeats after it
has gone. A memory contributes when it is **viewed or created** — the swell is
deferred until there is a garden to hear it in, so opening a memory and walking
back out means you hear it arrive in the room behind you.

Underneath sits **the bed**: a slow sustained pad built from the dominant
emotion of the whole wall. It is the only looping part, and it is the only part
that is genuinely collective. Without it the landing page would be silent
whenever nobody was touching anything.

Hovering a marble is a **preview**, not a contribution: a real two-second window
of that memory's recorded audio if it has any, otherwise the chord its words
were mapped to.

---

## Marble colour

> the orbs are colored marbles; deterministic random color pick from what's
> already on the wall

Seeded by the memory's own id, so a marble looks identical on every load and to
every visitor — you can tell someone "mine is the green one near the top" and be
believed. The parent is picked from the colours already present, then nudged in
hue, saturation and lightness so a new marble reads as a *relative* of something
in the jar rather than a duplicate. The colour is computed at contribution time
and frozen; marbles do not shift as the wall grows.

**One thing worth knowing:** a plain uniform pick is the obvious implementation
and it is wrong. Because every marble inherits, small early accidents compound —
simulating 80-marble walls produced all-red or all-blue gardens with half the
hue wheel never appearing. The pick is therefore weighted *against* how much of
that hue the wall already holds, and one marble in eight is drawn fresh from the
seed palette. Every colour still comes from a colour that was already there; the
jar just stays mixed. See the comment in `public/js/marble.js`.

---

## Layout

```
server.js                express: orb store, marble assignment, wall + stats
scripts/seed.js          puts a few memories on the wall; safe to re-run
data/orbs/<id>.json      one memory: sources, components, every version
uploads/<id>/            the original files
public/js/
  app.js                 router, masthead, the deferred-contribution queue
  garden.js              the scatter, hover previews, the live readout
  contribute.js          write / say / draw / show — the under-a-minute flow
  orbview.js             the sphere, the collage, the history timeline
  marble.js              colour inheritance and physical traits  (also imported by the server)
  emotion.js             memory text -> musical parameters, with explanations
  audioscape.js          the garden's Web Audio: the bed and the swells
  orbaudio.js            one memory's own decayed sound
  compose.js             the next version: decay, flashes, layout, audio recipe
  components.js          analysis -> the fixed component pool (runs once)
  analyze.js             canvas analysis, text splitting, media probing
  imagelayers.js         renders one image layer into a cached canvas
  rng.js                 seeded RNG so any stored version replays exactly
```

`compose.js`, `components.js`, `analyze.js`, `imagelayers.js`, `rng.js` and
`orbaudio.js` are the orb prototype's, essentially unchanged.

---

## Deploying

The garden is a shared wall, so it needs a **persistent filesystem** for
`data/orbs` and `uploads`. Vercel and other ephemeral-filesystem hosts will lose
every contribution on redeploy — use Render, Railway, or Fly with a volume
mounted at the project root.

- `PORT` — defaults to 5173.
- `MODERATION_KEY` — set this to enable `DELETE /api/orbs/:id` via the
  `x-moderation-key` header. Without it, deletion is refused entirely: a shared
  wall should not let whoever is looking at a memory remove it.
- `ffmpeg` is optional, and used only when the browser cannot decode an upload
  at all. Without it, undecodable files are skipped with a notice.

---

## Endpoints

| | |
|---|---|
| `GET /api/wall` | every memory, newest first, with marble, emotion and preview window |
| `GET /api/stats` | live counts: memories, openings, fragments, mean decay, emotion split, contributions per day |
| `POST /api/orbs` | a contribution (multipart: `manifest` + `files`) |
| `GET /api/orbs/:id` | one memory in full, including every past version |
| `POST /api/orbs/:id/versions` | append a composed version and advance the decay |

---

## Known gaps

- The mascot is inline SVG. It is placeholder-grade and is the first thing to
  replace with a real illustration.
- Contributions are not rate-limited or moderated. A public wall on the open
  internet will need both.
- `uploads/` ships with one small sample memory. The two video-heavy samples
  from the orb prototype were left out — they were 119 MB.
