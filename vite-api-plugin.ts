// Local stand-in for `vercel dev`, kept entirely local (no Vercel CLI, no
// account/project linking, no network calls out). Lets `npm run dev` serve
// both the frontend and the /api/*.ts serverless functions from one process.
//
// Route resolution: /api/<segments> -> api/<segments>.ts, exact match only
// (no [param] dynamic segments yet — added when a step actually needs one).
// Each api/*.ts file exports functions named after HTTP methods, e.g.
// `export async function POST(request: Request): Promise<Response> { ... }`,
// following the same Fetch API contract Vercel functions use.
//
// Hot-reload caveat: the cache-busting query param below only forces a
// fresh import of the top-level api/*.ts entry file. Its own relative
// imports (lib/*.ts etc.) resolve through Node's normal ESM cache and are
// NOT re-evaluated — editing lib/llm.ts, lib/supabase.ts, etc. requires
// restarting `npm run dev` to take effect. Only edits to the api/*.ts file
// itself are picked up live.

import type { Plugin, Connect } from "vite";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API_DIR = path.join(import.meta.dirname, "api");

async function nodeRequestToFetchRequest(req: Connect.IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  const method = req.method ?? "GET";
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }

  return new Request(url, { method, headers, body });
}

export function localApiPlugin(): Plugin {
  return {
    name: "local-api-routes",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();

        const pathname = new URL(req.url, "http://localhost").pathname;
        const relativePath = pathname.slice("/api/".length);
        const filePath = path.join(API_DIR, `${relativePath}.ts`);

        if (!existsSync(filePath)) return next();

        try {
          // Cache-bust so edits to api/*.ts are picked up without restarting the dev server.
          const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
          const mod = await import(moduleUrl);
          const handler = mod[req.method ?? "GET"];

          if (typeof handler !== "function") {
            res.statusCode = 405;
            res.end(`Method ${req.method} not allowed on ${pathname}`);
            return;
          }

          const request = await nodeRequestToFetchRequest(req);
          const response: Response = await handler(request);

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          const responseBody = Buffer.from(await response.arrayBuffer());
          res.end(responseBody);
        } catch (err) {
          console.error(`[local-api] ${pathname} threw:`, err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });
    },
  };
}
