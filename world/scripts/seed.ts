// Step 1.7 — seeds 200 synthetic memories through the real pipeline
// (moderate -> IR extract + candidates -> score -> derive visual spec ->
// place -> insert), same functions api/submit.ts uses. Only moderate and
// IR-extract spend Gemini quota — visual spec is rule-based (lib/
// visualspec.ts), not a third call. Hand-written source list below,
// organized into themed clusters — three required by the spec
// (Christmas/winter/family, school, grandparents, ~15 each) plus ten more
// spanning the other anchor themes, so consolidation (Step 4.1) and anchor
// placement (Step 1.6) both have real clusters to work with.
//
// Usage:
//   node scripts/seed.ts --dry-run       print without inserting
//   node scripts/seed.ts --limit=20      only seed the first N (post-interleave)
//   node scripts/seed.ts                 seed all 200

import { moderateText, extractMemoryIR } from "../lib/llm.ts";
import { scoreCandidates } from "../lib/score.ts";
import { deriveVisualSpec } from "../lib/visualspec.ts";
import { retrieveAsset, SCALE_MULTIPLIERS } from "../lib/assetRegistry.ts";
import { resolvePlacement, markAnchorOccupied } from "../lib/placementPipeline.ts";
import { supabase } from "../lib/supabase.ts";

const CHRISTMAS_WINTER_FAMILY = [
  "Every Christmas Eve my whole family crammed into my grandmother's tiny living room and someone always knocked the tree over.",
  "The smell of cinnamon and pine still takes me straight back to my childhood living room on Christmas morning.",
  "My dad would put on the same scratchy vinyl of holiday songs every December first, no exceptions.",
  "We used to leave a plate of cookies out for Santa and I was convinced the crumbs proved he'd been there.",
  "The year it actually snowed on Christmas Day, my brother and I built a lopsided snowman before breakfast.",
  "My mom kept a tiny reindeer decoration on the windowsill and I'd sit there waiting for my cousins to arrive.",
  "Wrapping presents at midnight with my sister, both of us exhausted and laughing at how bad our bows looked.",
  "The whole family used to pile onto one couch to watch the same Christmas movie every single year.",
  "I remember shivering in the driveway hanging lights with my dad while he cursed at a tangled cord.",
  "Opening one present on Christmas Eve was our tradition, and I always tried to guess what it was by shaking it.",
  "My grandfather carved the turkey every year with a ceremonial seriousness that made us kids giggle.",
  "The first Christmas after we moved, nothing felt right until my mom hung the same ornaments in the new house.",
  "I used to sneak downstairs at 2am just to look at the lit-up tree in the dark, quiet house.",
  "My aunt always overcooked the ham but nobody ever said anything because it wouldn't have felt like Christmas otherwise.",
  "We'd drive around the neighborhood in pajamas looking at lights, hot chocolate spilling in the cupholders.",
];

const SCHOOL = [
  "My first day of kindergarten I cried so hard the teacher had to carry me in from the parking lot.",
  "I still remember the exact desk I sat at in third grade, third row, by the window.",
  "The smell of a freshly sharpened pencil still makes me think of standardized testing mornings.",
  "I got picked last for kickball so many times that I started pretending I didn't want to play anyway.",
  "My best friend and I passed notes folded into tiny triangles all through seventh grade math.",
  "The day I finally understood long division felt like the biggest victory of my entire childhood.",
  "I forgot my lines in the school play and just stood there frozen while the whole auditorium waited.",
  "Our substitute teacher let us watch a movie every single time and we all silently loved her for it.",
  "I got sent to the principal's office once for talking back and I still remember the sick feeling in my stomach.",
  "The library was the only quiet place in that entire school and I spent every lunch period hiding there.",
  "My high school chemistry teacher believed in me more than I believed in myself that year.",
  "I bombed my driving test the first time and had to walk past all my classmates to get back inside.",
  "Graduation day felt strangely anticlimactic after twelve years of building up to that one walk across the stage.",
  "I used to trade my sandwich for someone else's chips every day at lunch without either of us complaining.",
  "The lockers in my middle school always smelled faintly like old gym socks and cafeteria pizza.",
];

const GRANDPARENTS = [
  "My grandmother's kitchen always smelled like fresh bread no matter what time of day you walked in.",
  "My grandfather taught me how to fish off the dock behind his house, patient with every tangled line.",
  "She kept a jar of butterscotch candies on the side table and I always knew exactly where to find it.",
  "My grandpa fell asleep in his recliner every single evening with the TV still playing static.",
  "I used to help my grandmother hang laundry on the line, clothespins clenched between my teeth.",
  "He told the same three stories from the war every holiday and we all pretended it was the first time hearing them.",
  "My grandmother's hands were always busy, knitting or peeling something, even during our conversations.",
  "The drive to my grandparents' farm always felt endless as a kid, but I loved every mile of it.",
  "My grandpa let me steer the truck down the gravel driveway even though I could barely see over the wheel.",
  "She used to sing to herself in the garden without realizing anyone could hear her.",
  "My grandfather's toolshed smelled like sawdust and motor oil and I loved just sitting in there with him.",
  "I still have the recipe card my grandmother wrote out in her looping cursive handwriting.",
  "He'd slip me a five dollar bill every visit and tell me not to tell my parents.",
  "My grandmother's porch swing creaked in exactly the same rhythm every summer evening.",
  "The last time I saw my grandfather, he was sitting in the garden just watching the birds.",
];

const HOME_BELONGING = [
  "There was a creaky floorboard right outside my bedroom door that I learned to step over in the dark.",
  "My childhood bedroom wallpaper had tiny sailboats on it and I used to trace them before falling asleep.",
  "We had a junk drawer in the kitchen that somehow contained every single tool anyone ever needed.",
  "The back porch was where my family actually talked to each other, usually after everyone else had gone to bed.",
  "I knew our house was truly home the day I stopped needing the hallway light on to find the bathroom.",
  "My mom rearranged the living room furniture so often that I'd sometimes walk into a wall at night.",
  "There was a specific spot on the stairs where you could hear every conversation happening in the kitchen.",
  "Our dog had a favorite sunny patch on the carpet that moved with the afternoon light.",
  "I painted my bedroom door blue in high school and my dad never quite forgave the color choice.",
  "The refrigerator was covered in magnets from places we'd never actually visited as a family.",
  "My sister and I built a blanket fort in the living room that stayed up for almost a week.",
  "The garage always smelled like gasoline and cut grass, no matter the season.",
  "I used to sit on the kitchen counter while my mom cooked, swinging my legs and asking too many questions.",
  "There was a window seat in the hallway where I did all my reading growing up.",
  "Moving out of that house for the last time, I stood in the empty living room and it looked so much smaller than I remembered.",
  "The kitchen island became the unofficial meeting spot for every important family conversation growing up.",
  "I still remember exactly which stair creaked, and used it to sneak extra cookies without anyone noticing.",
];

const ABSENCE_LOSS = [
  "My best friend moved away when I was ten and we promised to write letters that eventually just stopped.",
  "The year my parents divorced, the house felt too quiet even when everyone was actually home.",
  "I still reach for my phone to text my old roommate before remembering we don't really talk anymore.",
  "Our dog died the summer before I left for college and I still expect to hear him at the door sometimes.",
  "I never got to say goodbye properly before she moved overseas, and it still bothers me years later.",
  "The chair at the end of the table has stayed empty since my uncle passed, and nobody's ever sat in it.",
  "My childhood best friend and I drifted apart so gradually that I can't pinpoint when it actually happened.",
  "I found an old voicemail from my dad on my phone and I haven't been able to delete it since he passed.",
  "The apartment felt enormous and silent the week after my partner and I broke up.",
  "I still have my grandmother's sweater in my closet even though it's been years since she passed.",
  "We lost touch after high school graduation, the way so many friendships quietly do.",
  "My childhood home was sold last year and I still think about who sleeps in my old room now.",
  "The year my cat disappeared, I kept setting out food for weeks, hoping he'd come back.",
  "I still catch myself wanting to call my grandfather's old phone number out of habit.",
  "Watching my brother pack up his room for college felt like the end of something I couldn't name.",
];

const FIRST_TIMES = [
  "My first kiss happened awkwardly behind the bleachers and neither of us knew what to do afterward.",
  "The first time I drove alone, I gripped the wheel so hard my hands cramped by the time I got home.",
  "I remember the exact moment I got my first paycheck and felt like a completely different person.",
  "My first apartment had a leaky faucet and paper-thin walls, and I loved it more than anywhere since.",
  "The first time I flew on a plane alone, I was terrified and thrilled in equal measure.",
  "I still remember the rush of catching my first fish, even though it was barely bigger than my hand.",
  "My first job interview I sweated through my shirt and somehow still got the position.",
  "The first time I cooked dinner for someone I liked, I burned the garlic and panicked the whole time.",
  "I got my first tattoo on a whim with a friend, and I still don't regret the terrible line work.",
  "My first heartbreak felt like the entire world had personally decided to end.",
  "The first time I lived alone, I remember standing in the empty apartment feeling both scared and free.",
  "I still remember the exact feeling of riding a bike without training wheels for the very first time.",
  "My first real fight with my best friend felt like the ground had shifted under both of us.",
  "The first time I held my newborn niece, I forgot every word I knew how to say.",
  "I bombed my first public speech so badly that I avoided the stage for years after.",
  "The first time I traveled to another country alone, I got lost within twenty minutes of landing.",
];

const MOTION_TRAVEL = [
  "The overnight train ride across the mountains kept me wide awake, pressed against the window the whole way.",
  "We drove twelve hours straight to the coast one summer, singing badly to the radio the entire trip.",
  "My backpack broke on the first day of the hike and I had to carry it against my chest for miles.",
  "I fell asleep on a bus in a foreign country and woke up three stops past where I needed to be.",
  "The road trip playlist my friends made still plays in my head every time I merge onto a highway.",
  "Moving to a new city alone, I remember sitting in my car outside the new apartment, too nervous to go in.",
  "We got hopelessly lost hiking that trail and ended up finding a waterfall nobody had told us about.",
  "The flight got delayed six hours and somehow that turned into one of my favorite travel memories.",
  "I hitchhiked once as a teenager and told my parents a much less honest version of that day.",
  "The car broke down in the middle of nowhere and we ended up having the best conversation of the whole trip.",
  "I still remember the exact bend in the highway where you could first see the ocean on that drive.",
  "We packed the car so full that my sister had to hold a lamp on her lap for six hours.",
  "The ferry ride was rougher than expected and half the passengers spent it leaning over the railing.",
  "I missed my connecting flight and ended up spending an unplanned night in an airport terminal.",
  "Driving cross-country with nothing but a paper map, we got lost constantly and somehow loved it.",
];

const NIGHT_SLEEPLESSNESS = [
  "I used to lie awake counting the cars that passed under my window until I eventually fell asleep.",
  "The night before my wedding I barely slept at all, just stared at the ceiling replaying every detail.",
  "We stayed up all night talking on the porch until the sky turned that strange pale blue before sunrise.",
  "I still remember the specific quiet of the house at 3am when I couldn't sleep as a kid.",
  "The thunderstorm woke me up and I crawled into my parents' bed even though I was far too old for that.",
  "I pulled an all-nighter studying for finals fueled entirely by vending machine coffee and panic.",
  "The night my dad came home late from the hospital, I sat awake on the stairs waiting to hear his voice.",
  "I used to sneak out of my window at night just to sit on the roof and look at the stars.",
  "The insomnia got so bad that summer I started recognizing the same late-night radio hosts by voice.",
  "We watched the sunrise after staying up all night, too tired to talk but not ready to say goodbye yet.",
  "I woke up at 4am the morning of the flight, too anxious and excited to fall back asleep.",
  "The power went out during the storm and we told stories by flashlight until we all fell asleep on the floor.",
  "I remember staring at the glow-in-the-dark stars on my ceiling, convinced they were the real thing.",
  "The night before the surgery, none of us in the waiting room said much of anything at all.",
  "I used to fall asleep to the sound of my parents' voices murmuring through the wall.",
];

const FOOD_KITCHENS = [
  "My mother's hands were always covered in flour every Sunday morning making bread from scratch.",
  "I burned my first attempt at cooking dinner so badly the smoke alarm woke up the whole building.",
  "The smell of my dad's chili simmering all afternoon meant it was finally a good weekend.",
  "We used to make pancakes shaped like animals every Saturday, mine always came out looking like blobs.",
  "The first time I successfully baked bread from scratch, I nearly cried over how good it smelled.",
  "My family's secret ingredient was never actually a secret, we just liked pretending it was.",
  "I still remember exactly how the kitchen looked during holidays, every surface covered in dishes.",
  "The diner down the street knew our order before we even sat down, every single Sunday.",
  "I learned to cook by standing on a stool next to my mom, stirring whatever she handed me.",
  "We had a disastrous attempt at a souffle that collapsed the second we opened the oven door.",
  "The smell of garlic and onions hitting a hot pan still means home to me no matter where I am.",
  "My roommate and I tried to bake a cake from scratch and somehow ended up ordering pizza instead.",
  "I remember licking the spoon after helping make cookie dough, getting scolded every single time.",
  "The farmers market on Saturday mornings was the highlight of my entire week growing up.",
  "My dad's pancakes were always slightly burnt, and somehow that became the whole point.",
];

const FEAR_FAILURE = [
  "I froze completely during my final exam and stared at the paper for twenty minutes without writing a word.",
  "The panic of realizing I'd locked my keys in the car in the middle of a snowstorm still makes my chest tight.",
  "I failed my driving test twice before finally passing on the third nervous attempt.",
  "Standing backstage before the recital, I was so terrified I almost walked out the back door instead.",
  "I dropped the tray of dishes on my very first shift at the restaurant, in front of every single customer.",
  "The fear of disappointing my parents kept me up more nights than I'd like to admit.",
  "I got lost hiking alone and spent an hour convinced I'd never find the trail again.",
  "My hands shook so badly during the interview that I could barely hold the coffee cup they offered me.",
  "I choked during the big game and missed the shot that would have won us the championship.",
  "The first time I spoke in front of the whole school, my voice cracked and everyone laughed.",
  "I was terrified my project wouldn't be good enough, so I stayed up all night rewriting it.",
  "Losing my job felt like the floor had dropped out from under everything I thought I knew.",
  "I still remember the fear of the doctor's waiting room before getting the test results back.",
  "The first time I tried to parallel park during my test, I hit the curb so hard the examiner flinched.",
  "I was so scared of the dark as a kid that I made my brother check under the bed every single night.",
];

const SOMEONE_ELSE = [
  "My little brother used to follow me everywhere, and I complained about it constantly until he stopped.",
  "A stranger paid for my coffee once when my card got declined, and I still think about that kindness.",
  "My college roommate taught me how to cook the only meal I still know how to make well.",
  "My neighbor used to leave vegetables from her garden on our doorstep every single summer.",
  "The bus driver on my childhood route always waited that extra ten seconds if he saw you running.",
  "My coach believed I could make the team long before I believed it myself.",
  "A woman on the train once gave up her seat for my exhausted mother without either of us asking.",
  "My best friend's mom always set an extra place at the table without ever needing to be asked.",
  "My little sister used to crawl into my bed during thunderstorms, even after we both grew up.",
  "The mailman knew everyone on our street by name and always had something kind to say.",
  "My childhood piano teacher never once raised her voice, even when I clearly hadn't practiced.",
  "A classmate I barely knew stood up for me once during an argument I couldn't win alone.",
  "My uncle taught me how to change a tire in a gas station parking lot in the pouring rain.",
  "The librarian always saved the new releases for me before they hit the shelf.",
  "My roommate stayed up all night with me the week everything fell apart, saying almost nothing at all.",
];

const WATER_WEATHER = [
  "We used to run outside every time it started thunderstorming, standing on the porch to watch the lightning.",
  "The lake behind our cabin froze solid every winter and my dad taught us how to test the ice safely.",
  "I still remember the exact sound of rain hitting the tin roof of my grandparents' porch.",
  "The first big snow of the year always felt like the whole town silently agreed to stop and just look at it.",
  "I learned to swim in a cold lake that summer, terrified and shivering the entire first lesson.",
  "The hurricane knocked out power for a week and somehow those became some of my favorite memories.",
  "We built sandcastles all afternoon only to watch the tide wash them away within minutes.",
  "The smell of rain on hot pavement instantly takes me back to summer afternoons on my childhood street.",
  "I got caught in a sudden downpour walking home from school and just decided to enjoy it instead of running.",
  "The pond behind our house was full of frogs every spring, and I spent hours trying and failing to catch one.",
  "A rogue wave knocked me clean off my feet at the beach and I came up laughing and coughing up saltwater.",
  "The first snow day of the year meant sledding down the hill behind the school on cafeteria trays.",
  "I remember the eerie stillness right before a big storm hit, the sky turning that strange greenish color.",
  "We waded into the river every summer even though the water was always shockingly cold.",
  "The fog rolled in so thick one morning that I couldn't see the house across the street.",
  "I used to collect seashells on the beach with my grandmother every summer morning before anyone else woke up.",
];

const WORK_MAKING = [
  "I built a birdhouse from scratch in the garage one summer, sanding every piece by hand until it was smooth.",
  "My first real job was scooping ice cream, and I still remember how my hands smelled like sugar for weeks.",
  "I taught myself to knit from an online video and made my mother the crookedest scarf she ever wore proudly.",
  "The night before the deadline, I rewrote the entire project from scratch, convinced the first draft wasn't good enough.",
  "I spent an entire summer restoring an old bicycle I found abandoned behind the garage.",
  "My first paycheck felt enormous, even though it barely covered a week of groceries.",
  "I quit a job I hated on a random Tuesday and felt lighter than I had in months.",
  "Learning to weld left burn marks on my sleeves for an entire year before I finally got the hang of it.",
  "I spent months building a treehouse with my dad, and it was crooked but somehow still stood for a decade.",
  "The first painting I ever sold was to a stranger who didn't know it took me three failed attempts to finish.",
  "I stayed late every night that month finishing the project, terrified it still wouldn't be good enough.",
  "My grandfather's old toolbox became mine when I started fixing up the house myself, piece by piece.",
  "I learned to sew by unpicking my own mistakes more times than I care to admit.",
  "The garden I planted that spring barely produced anything, but I was strangely proud of every wilted tomato.",
  "I worked three summers at the hardware store just to save up for my first car.",
  "Building the deck with my brother took twice as long as we planned, but neither of us wanted it to end.",
];

const CATEGORIES = [
  CHRISTMAS_WINTER_FAMILY,
  SCHOOL,
  GRANDPARENTS,
  HOME_BELONGING,
  ABSENCE_LOSS,
  FIRST_TIMES,
  MOTION_TRAVEL,
  NIGHT_SLEEPLESSNESS,
  FOOD_KITCHENS,
  FEAR_FAILURE,
  SOMEONE_ELSE,
  WATER_WEATHER,
  WORK_MAKING,
];

// Round-robin across categories so even a small --limit run samples many
// themes instead of exhausting one cluster first.
function interleave(categories: string[][]): string[] {
  const result: string[] = [];
  const maxLen = Math.max(...categories.map((c) => c.length));
  for (let i = 0; i < maxLen; i++) {
    for (const cat of categories) {
      if (i < cat.length) result.push(cat[i]);
    }
  }
  return result;
}

export const MEMORIES = interleave(CATEGORIES);

type SeedOutcome = "llm" | "fallback" | "flagged";

async function seedOne(rawText: string, dryRun: boolean, index: number, total: number): Promise<SeedOutcome> {
  const label = `[seed] (${index + 1}/${total})`;
  const { flagged } = await moderateText(rawText);

  if (flagged) {
    console.log(`${label} FLAGGED (unexpected for synthetic data): "${rawText.slice(0, 60)}..."`);
    if (!dryRun) {
      const { error } = await supabase.from("memories").insert({
        input_type: "text",
        raw_text: rawText,
        ir: {},
        epitaph: "",
        category: "natural",
        noun: "stone",
        label: "a plain grey stone",
        fallback_archetype: "stone",
        grounding_evidence: [],
        asset_search_terms: ["stone"],
        semantic_tags: ["stone", "fallback"],
        visual_spec: {
          material: "stone",
          condition: "worn",
          scale: "small",
          animation: "still",
          primaryColor: "grey",
          glow: 0,
          preferredPlacement: "generic",
          explanation: ["Flagged submission — not interpreted."],
          assetId: "rock_01",
          assetPath: "/models/nature/rock.glb",
          finalScale: 0.56,
        },
        visual_representation: {
          assetId: "rock_01", assetPath: "/models/nature/rock.glb", retrievalTier: "keepsake", retrievalScore: 0,
          scale: 0.56, colorFamily: "grey", condition: "worn", materialStyle: "rough", animation: "still",
        },
        generated_asset_url: null,
        render_status: "local_3d",
        entity_kind: "standalone_object",
        environment_tags: [],
        preferred_anchors: [],
        structure_id: null,
        anchor_id: null,
        x: Math.random() * 1000 - 500,
        y: Math.random() * 1000 - 500,
        flagged: true,
      });
      if (error) console.error(`${label} flagged insert failed:`, error);
    }
    return "flagged";
  }

  const { ir, source } = await extractMemoryIR(rawText);
  const { scored, summaryEmbedding } = await scoreCandidates(ir, rawText);
  const winner = scored[0];
  const visualSpec = deriveVisualSpec(winner, ir);
  const retrieval = retrieveAsset({
    entityKind: winner.entityKind, noun: winner.noun, label: winner.label,
    assetSearchTerms: winner.assetSearchTerms, semanticTags: winner.semanticTags,
    groundingEvidence: winner.groundingEvidence, placementRequirements: winner.placementRequirements,
    appearance: winner.appearance, behavior: winner.behavior,
  });
  const finalScale = retrieval.asset.defaultScale * SCALE_MULTIPLIERS[winner.appearance.scale];
  const visualRepresentation = {
    assetId: retrieval.asset.id, assetPath: retrieval.asset.path, retrievalTier: retrieval.tier,
    retrievalScore: retrieval.score, scale: finalScale, colorFamily: winner.appearance.colorFamily,
    condition: winner.appearance.condition, materialStyle: winner.appearance.materialStyle,
    animation: winner.behavior.animation,
  };
  Object.assign(visualSpec, { assetId: retrieval.asset.id, assetPath: retrieval.asset.path, finalScale });
  const placement = await resolvePlacement(winner, summaryEmbedding);

  console.log(
    `${label} "${rawText.slice(0, 50)}..." -> "${winner.label}" (${winner.entityKind}, fallback: ${winner.fallbackArchetype}) ` +
      `asset=${retrieval.asset.id} @ (${placement.x.toFixed(0)},${placement.y.toFixed(0)})` +
      (placement.topAnchor ? ` near ${placement.topAnchor}` : ` in structure ${placement.structure_id}`) +
      ` [${source}]`
  );

  if (!dryRun) {
    const { data, error } = await supabase
      .from("memories")
      .insert({
        input_type: "text",
        raw_text: rawText,
        ir,
        epitaph: ir.epitaph,
        category: winner.category,
        noun: winner.noun,
        label: winner.label,
        fallback_archetype: winner.fallbackArchetype,
        grounding_evidence: winner.groundingEvidence,
        asset_search_terms: winner.assetSearchTerms,
        semantic_tags: winner.semanticTags,
        visual_spec: visualSpec,
        visual_representation: visualRepresentation,
        generated_asset_url: null,
        render_status: "local_3d",
        candidates: scored,
        embedding: summaryEmbedding,
        entity_kind: winner.entityKind,
        environment_tags: winner.placementRequirements.environmentTags,
        preferred_anchors: winner.placementRequirements.preferredAnchors,
        structure_id: placement.structure_id,
        anchor_id: placement.anchor_id,
        x: placement.x,
        y: placement.y,
      })
      .select("id")
      .single();
    if (error) console.error(`${label} insert failed:`, error);
    else if (placement.structurePlacement) await markAnchorOccupied(placement.structurePlacement, data.id);
  }

  return source;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const startArg = args.find((a) => a.startsWith("--start="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : MEMORIES.length;
  const start = startArg ? parseInt(startArg.split("=")[1], 10) : 0;

  // --start resumes from a given index (post-interleave) without
  // reprocessing/re-spending quota on items that already succeeded, e.g.
  // after a mid-run network drop: --start=131 to redo from item 132.
  const toSeed = MEMORIES.slice(start, start + limit);
  console.log(
    `[seed] ${toSeed.length} memories (indices ${start}-${start + toSeed.length - 1})${dryRun ? " (dry run, nothing will be inserted)" : ""}...\n`
  );

  const counts: Record<SeedOutcome, number> = { llm: 0, fallback: 0, flagged: 0 };

  for (let i = 0; i < toSeed.length; i++) {
    const outcome = await seedOne(toSeed[i], dryRun, start + i, MEMORIES.length);
    counts[outcome]++;
    // Gemini free tier: 15 req/min, 2 calls/item (moderate + IR) -> max
    // sustainable rate is 7.5 items/min, i.e. >=8s/item. lib/llm.ts also
    // retries once on 429 as a backstop, but pacing correctly is what
    // avoids burning good content into false "flagged" results at scale.
    await new Promise((r) => setTimeout(r, 8500));
  }

  console.log(`\n[seed] done. ${toSeed.length} processed.`);
  console.log(`[seed] source breakdown: llm=${counts.llm} fallback=${counts.fallback} flagged=${counts.flagged}`);
}

// Guard against running main() as a side effect of being imported (e.g. a
// script that just wants MEMORIES/CATEGORIES) — only run when invoked
// directly: `node scripts/seed.ts`.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[seed] fatal error:", err);
    process.exit(1);
  });
}
