// Placeholder Vercel serverless function.
// Real routes (submit, world, memory/[id], tick) land in Phase 1+.
// Not wired into the build yet — this just proves the /api convention
// is in place for when Vercel (or `vercel dev`) picks it up.

export function GET() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}
