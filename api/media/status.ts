const ALLOWED_NAME = /^files\/[a-z0-9-]+$/;

export async function GET(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!ALLOWED_NAME.test(name)) return Response.json({ error: "invalid file name" }, { status: 400 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    headers: { "x-goog-api-key": apiKey },
  });
  const data = await response.json();
  return Response.json(data, { status: response.status });
}
