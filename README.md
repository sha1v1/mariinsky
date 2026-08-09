# mariinsky — a memory collective

A shared wall of memories. Leave one moment; it becomes a marble among a page of
junk. Every time somebody opens it, it gives itself back one piece at a time
from a different handful of its own fragments, and a little more of it is gone.

```bash
npm install
npm run items    # cuts the page's objects out of the asset library (see below)
npm run seed     # optional: puts a few memories on the wall so it is not empty
npm start        # http://localhost:5173
```

No build step. Node 18+, Express, and vanilla ES modules.

`npm run items` is the one thing that has to happen before the first run. It
looks for the asset library at `../assets` (override with `ITEM_SRC`) and writes
trimmed, white-keyed cut-outs into `public/images/items/`, which is generated
and not checked in. Without it the page has nothing to lay out but marbles.

---

## The two worlds

**The collection** is a page out of an i-spy book, inside a printed blue border:
paper white, flat, no drop shadows, nothing labelled, and nothing overlapping
anything else. Mariinsky lies in the middle with the title printed across her
side, and the grid is cut around her so nothing is ever laid across the dog.
Sweeping the cursor over a memory plays its own sound for exactly as long as you
stay on it, and its title wraps itself around it.

A memory **is an object**, chosen by what it says: "the smell of bakery bread"
is a pretzel, "my sister's birthday" is a slice of cake. When nothing in the
library is close it stays a marble — which is not a failure state, it is what a
memory looks like before it has told you enough to be a picture of anything.
Matching is a keyword table in `items.js`, not a model: it runs on the wall
payload with no network call, it is inspectable, and a wrong match is a wrong
picture rather than a wrong memory.

Most of what is on the page is **not** a memory. Every cell a memory did not
take gets a trinket out of the same library, so the page is full at any wall
size. That is not decoration for its own sake: a hunt needs something to hunt
through, and eleven objects alone on white paper is a dashboard, not a spread.
Trinkets are inert — no pointer, no focus, no hover, not in the tab order — and
that, rather than what they are pictures of, is what tells them apart. A memory
answers when you touch it. Making the junk look different from the memories
would not be a hunt, it would be a spot-the-odd-one-out.

The page is sized to the **window** first: rows and columns are chosen so a wall
that fits lands inside one screen exactly, margins included, and nothing is
cropped by the printed border. Only when there are more memories than the screen
has cells does the page grow past the window and become something you drag.
Panning is what you do when there is too much to fit, not the resting state of a
page with eleven things on it.

**Inside a memory** is the opposite: the page frosts over and one sphere rises
out of the marble you clicked, lit by a gradient built from its own photographs
(or, if it is only words, from the mood those words were read as). It is always
dead centre, at every window size. There is no back button and no controls —
click anywhere outside it. Its own sound comes up over the collection while it
is open.

**Leaving a memory** uses the same door: a card over the frosted collection,
dismissed by clicking outside it. Backing out of writing costs exactly as little
as backing out of reading, and leaving that way creates nothing. When a
contribution is accepted the card gets out of the way and the new marble is
flown from the middle of the screen into its slot, so you see *where it went* —
on a page this full, a marble that simply appeared would be indistinguishable
from one that had always been there.

---

## What happens to a contribution

1. It is **torn into components** the moment it arrives — image layers cut at
   the picture's own luminance percentiles, phrase fragments, video time
   portions, overlapping audio windows. This happens once, in the browser, at
   upload. Nothing is ever re-cut.
2. It is **read for emotion** by keyword-matching against five word lists. There
   is no model in this path, which is exactly why the interface can explain it
   in one sentence — and does, before you contribute.
3. It is **given a marble colour** drawn from the marbles already on the wall.
4. It is **given a recipe** (`settings`) that says how it replays. Every memory
   is born with the schema defaults; the recipe is per-memory from day one so
   tuning one never disturbs the rest of the wall.

---

## How a memory gives itself back

Ported from the orb prototype (`2-prototype-muta`). A memory replays in one of
two modes, chosen by its own recipe:

**sequence** (the default) — one thing at a time, running until you leave. A
stream is endless, so it stores no list of beats: it stores a seed, and every
beat is derived from it (`beat i <- mulberry32(seed ^ hash(i))`), which is what
lets an endless thing still be replayed exactly. Three clocks run past each
other on purpose — beats, drifting words that outlive the picture they arrived
over, and sound, which changes every few beats and only occasionally lands on a
cut.

**collage** — one arrangement, everything at once, held still on the glass. A
collage version stores its whole arrangement.

Rot is a **function of how many times the memory has been opened**, not a random
walk upward from wherever the last version landed: a sixth opening is 30% gone, a
twelfth 70%, a twentieth 90%. On top of that sits **strain** — holding a memory
open costs it something, most of which relaxes when you close it, and a fraction
of which is folded in for good. A sequence is committed to the history the
moment it starts; what you stayed for is written back when you leave, by beacon,
because closing the tab is the common way to go and `fetch` does not survive it.

Roughly one moment in six, something long-absent returns at full clarity while
everything around it stays faded. A vivid flash suspends the lot: no strobing,
no blur, full colour, full volume, however far gone the rest of it is.

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
deferred until there is a collection to hear it in, so opening a memory and
walking back out means you hear it arrive in the room behind you.

Underneath sits **the bed**: a slow sustained pad on a fixed C major I-IV-V-I,
written low so it sits under the swells rather than in among them. It is the
only looping part, and it does not follow the wall. It used to — it was built
from whichever emotion the wall held most of — but that meant the room's
resting sound swung between C major, A minor and open quartal voicings
depending on what had been left there, and on a wall with a tie it came down to
object key order. The room stays itself; the memories are what vary.

Hovering a marble is a **preview**, not a contribution: a real two-second window
of that memory's recorded audio if it has any, otherwise the chord its words
were mapped to.

---

## Marble colour

> the orbs are colored marbles; deterministic random color pick from what's
> already on the wall

This is the colour of a memory that stayed a marble — the ones the object
library had nothing close for. Seeded by the memory's own id, so a marble looks
identical on every load and to every visitor — you can tell someone "mine is the green one near the top" and be
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
scripts/items.mjs        asset library -> trimmed, keyed cut-outs (npm run items)
data/orbs/<id>.json      one memory: sources, components, recipe, every version
uploads/<id>/            the original files
public/js/
  app.js                 router, the two overlays, the deferred-contribution queue
  garden.js              the scatter, hover previews, the landing animation
  items.js               memory text -> which object it is; the filler pool; fitting
  trinkets.js            the rest of the i-spy page
  mascot.js              Mariinsky, and the four clocks she moves on
  contribute.js          write / say / draw / show — the under-a-minute flow
  orbview.js             the sphere: the modal shell over both replay modes
  marble.js              colour inheritance and physical traits  (also imported by the server)
  emotion.js             memory text -> musical parameters, with explanations
  audioscape.js          the collection's Web Audio: the bed and the swells
  orbaudio.js            one memory's own decayed sound, in generations
  settings.js            the recipe schema: every knob, declared once
  compose.js             collage: decay, flashes, layout, audio recipe
  sequence.js            sequence: what beat i is, derived from the seed
  stream.js              sequence: the three clocks, honoured
  shaders.js             GLSL passes for image layers (off by default)
  components.js          analysis -> the fixed component pool (runs once)
  analyze.js             canvas analysis, text shredding, media probing
  imagelayers.js         renders one image layer into a cached canvas
  rng.js                 seeded RNG so any stored version replays exactly
```

`settings.js`, `compose.js`, `sequence.js`, `stream.js`, `shaders.js`,
`components.js`, `analyze.js`, `imagelayers.js`, `rng.js` and `orbaudio.js` come
from the orb prototype essentially unchanged. `orbview.js` is the prototype's
renderer inside this app's modal shell.

---

## Deploying

The collection is a shared wall, so it needs a **persistent filesystem** for
`data/orbs` and `uploads`. Vercel and other ephemeral-filesystem hosts will lose
every contribution on redeploy — use Render, Railway, or Fly with a volume
mounted at the project root.

- `PORT` — defaults to 5173.
- `MODERATION_KEY` — set this to enable `DELETE /api/orbs/:id` via the
  `x-moderation-key` header. Without it, deletion is refused entirely: a shared
  wall should not let whoever is looking at a memory remove it.
- `ffmpeg` is optional, and used only when the browser cannot decode an upload
  at all. Without it, undecodable files are skipped with a notice.

Orb writes are read-modify-write and a shared wall gets concurrent openings, so
they are serialised per id and land via a temp file and a rename. Two openings
arriving together used to interleave and leave a file that no longer parsed — a
memory that reported itself gone.

---

## Endpoints

| | |
|---|---|
| `GET /api/wall` | every memory, newest first, with marble, emotion and preview window |
| `GET /api/stats` | live counts: memories, openings, fragments, mean decay, emotion split, contributions per day |
| `POST /api/orbs` | a contribution (multipart: `manifest` + `files`) |
| `GET /api/orbs/:id` | one memory in full, including every past version |
| `POST /api/orbs/:id/versions` | begin a version — a collage arrangement, or a sequence seed |
| `PATCH`/`POST /api/orbs/:id/versions/:n` | the write-back: beats watched, what was seen, strain left behind. POST as well as PATCH because `sendBeacon` is always a POST |

---

## Known gaps

- The object-matching table in `items.js` is hand-written, so a memory only
  becomes a picture if its words happen to land on a tag. On the seed wall five
  of eleven match; the rest stay marbles. Widening it is a matter of typing, not
  of design, but the honest ceiling is that a library of 44 objects cannot cover
  what people actually leave here.
- Contributions are not rate-limited or moderated. A public wall on the open
  internet will need both.
- The laboratory (the prototype's per-memory tuning bench) was not brought
  across. Every memory runs the schema defaults, and the plumbing for per-memory
  recipes is already in place — `settings` on the record, `PUT` route absent.
- `uploads/` ships with one small sample memory. The two video-heavy samples
  from the orb prototype were left out — they were 119 MB.
