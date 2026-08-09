// Step 2.3 — camera (pan/drag, zoom/pinch, debounced refetch).
// Step 2.4 — real sprites via Sprite.ts, driven by a continuous
// requestAnimationFrame loop so idle animation (sway/breathe/flicker)
// actually plays, not just redraws-on-interaction.

import { useEffect, useRef, useState } from "react";
import {
  type Camera,
  type CameraFlight,
  clampCamera,
  worldToScreen,
  screenToWorld,
  viewportBBox,
  stepCameraFlight,
  ZOOM_MIN,
  ZOOM_MAX,
} from "../lib/camera.ts";
import { FALLBACK_ARCHETYPES, IMPLEMENTED_STRUCTURE_TEMPLATES } from "../lib/ontology.ts";
import { preloadSprites, drawSprite, type SpriteObject } from "./Sprite.ts";
import { drawStructure, preloadStructureArt, type StructureObject } from "./Structure.ts";
import SubmitPanel from "./SubmitPanel.tsx";

interface WorldObject extends SpriteObject {
  x: number;
  y: number;
  label: string;
  epitaph: string;
  is_composite: boolean;
  child_count: number;
  // World hierarchy — present on every row from the current pipeline, null
  // on legacy pre-refactor rows. Not read by rendering yet (x/y already
  // encode the final position either way); kept for future use (e.g.
  // highlighting an object's owning structure on hover).
  entity_kind?: string | null;
  structure_id?: string | null;
  anchor_id?: string | null;
}

interface WorldResponse {
  objects: WorldObject[];
  structures: StructureObject[];
}

const FETCH_DEBOUNCE_MS = 300;

function initialCamera(width: number, height: number): Camera {
  // Fit roughly the anchor circle (diameter ~2400, plus margin) into view.
  return clampCamera({ x: 0, y: 0, zoom: Math.min(width, height) / 2600 });
}

function touchDistance(t0: Touch, t1: Touch): number {
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
}

export default function World() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>(initialCamera(window.innerWidth, window.innerHeight));
  const objectsRef = useRef<WorldObject[]>([]);
  const structuresRef = useRef<StructureObject[]>([]);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const pinchRef = useRef({ active: false, lastDist: 0 });
  const rafRef = useRef<number | null>(null);
  // Step 3.1 — active camera flight (e.g. flying to a just-submitted
  // object), stepped once per render-loop frame. Null when idle.
  const flightRef = useRef<CameraFlight | null>(null);

  const [objects, setObjects] = useState<WorldObject[]>([]);
  const [structures, setStructures] = useState<StructureObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Step 3.1 — start (or replace) a camera flight toward a world point,
  // e.g. right after a submitted object lands. Zooms in a little if the
  // camera is currently too far out to actually see a single sprite.
  function flyCameraTo(x: number, y: number) {
    const cam = cameraRef.current;
    flightRef.current = {
      startX: cam.x,
      startY: cam.y,
      startZoom: cam.zoom,
      targetX: x,
      targetY: y,
      targetZoom: Math.max(cam.zoom, 0.6),
      startTime: performance.now(),
      duration: 700,
    };
  }

  function draw(timeMs: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Advance any in-flight camera animation. Reuses the same
    // scheduleRefetch debounce pan/zoom already drive, so the world
    // viewport refetches once the flight actually settles rather than
    // mid-flight on every frame.
    const flight = flightRef.current;
    if (flight) {
      const { camera, done } = stepCameraFlight(flight, timeMs);
      cameraRef.current = camera;
      scheduleRefetch();
      if (done) flightRef.current = null;
    }

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const camera = cameraRef.current;

    // Structures draw first (underneath) so the memory objects sitting at
    // their anchors render on top of the crude rectangle, not behind it.
    for (const structure of structuresRef.current) {
      const { x: sx, y: sy } = worldToScreen(camera, canvas.width, canvas.height, structure.x, structure.y);
      if (sx < -300 || sx > canvas.width + 300 || sy < -300 || sy > canvas.height + 300) continue;
      drawStructure(ctx, structure, sx, sy, camera.zoom);
    }

    for (const obj of objectsRef.current) {
      // A structure-kind memory's own row (the "childhood bedroom" itself,
      // not something *in* it) shares its x/y with the structure entity
      // Structure.ts just drew above — drawing it again as a fallback-
      // archetype sprite means a whole room renders as some unrelated tiny
      // icon (fallback_archetype is a closed enum with nothing sensible
      // for "a whole place" — see lib/ontology.ts) sitting dead-center in
      // its own rectangle. The structure's box + label is the render for
      // this memory; skip the redundant/misleading sprite.
      if (obj.entity_kind === "structure") continue;
      const { x: sx, y: sy } = worldToScreen(camera, canvas.width, canvas.height, obj.x, obj.y);
      if (sx < -80 || sx > canvas.width + 80 || sy < -80 || sy > canvas.height + 80) continue;
      drawSprite(ctx, obj, sx, sy, camera.zoom, timeMs);
    }
  }

  function fetchWorld() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x0, y0, x1, y1 } = viewportBBox(cameraRef.current, canvas.width, canvas.height);
    fetch(`/api/world?x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}`)
      .then((res) => res.json())
      .then((data: WorldResponse) => {
        setObjects(data.objects);
        setStructures(data.structures);
      })
      .catch((err) => {
        console.error("[World] failed to fetch /api/world:", err);
        setError("Failed to load the world.");
      });
  }

  function scheduleRefetch() {
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(fetchWorld, FETCH_DEBOUNCE_MS);
  }

  // Step 3.1 — SubmitPanel hands us back the raw inserted memories row.
  // Drop it into local state immediately (so it's visible before the next
  // /api/world round trip) and fly the camera there. The eventual
  // scheduleRefetch() the flight triggers replaces `objects` wholesale
  // with the server's view, which naturally reconciles this optimistic
  // insert (same row, no dupe) and also picks up a newly-created
  // structure if this memory was entity_kind: "structure" — that part
  // isn't rendered until that refetch lands.
  function handleSubmitted(row: Record<string, unknown>) {
    setObjects((prev) => [...prev, row as unknown as WorldObject]);
    if (typeof row.x === "number" && typeof row.y === "number") {
      flyCameraTo(row.x, row.y);
    }
  }

  // preload sprites once, then start the continuous render loop. Rendering
  // reads cameraRef/objectsRef every frame, so pan/zoom/data updates just
  // mutate those refs — no need to trigger draw() manually elsewhere.
  useEffect(() => {
    preloadSprites(FALLBACK_ARCHETYPES);
    preloadStructureArt(IMPLEMENTED_STRUCTURE_TEMPLATES);

    function loop(timeMs: number) {
      draw(timeMs);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    structuresRef.current = structures;
  }, [structures]);

  // window resize -> resize canvas, refetch (not debounced; a resize isn't
  // the rapid-fire gesture the pan/zoom debounce is guarding against).
  useEffect(() => {
    function handleResize() {
      setCanvasSize({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    fetchWorld();
  }, [canvasSize]);

  // pointer + wheel + touch input, mount-once. Handlers close over refs
  // only (cameraRef, dragRef, pinchRef, fetchTimeoutRef) plus stable
  // setState functions, so they stay correct despite the [] dep array.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onMouseDown(e: MouseEvent) {
      dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    }
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      const cam = cameraRef.current;
      cameraRef.current = clampCamera({ x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom });
      scheduleRefetch();
    }
    function onMouseUp() {
      dragRef.current.active = false;
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const cam = cameraRef.current;
      const worldBefore = screenToWorld(cam, canvas.width, canvas.height, mouseX, mouseY);
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * Math.exp(-e.deltaY * 0.001)));

      cameraRef.current = clampCamera({
        x: worldBefore.x - (mouseX - canvas.width / 2) / newZoom,
        y: worldBefore.y - (mouseY - canvas.height / 2) / newZoom,
        zoom: newZoom,
      });
      scheduleRefetch();
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        dragRef.current = { active: true, lastX: e.touches[0].clientX, lastY: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        dragRef.current.active = false;
        pinchRef.current = { active: true, lastDist: touchDistance(e.touches[0], e.touches[1]) };
      }
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (e.touches.length === 1 && dragRef.current.active) {
        const dx = e.touches[0].clientX - dragRef.current.lastX;
        const dy = e.touches[0].clientY - dragRef.current.lastY;
        dragRef.current.lastX = e.touches[0].clientX;
        dragRef.current.lastY = e.touches[0].clientY;
        const cam = cameraRef.current;
        cameraRef.current = clampCamera({ x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom });
        scheduleRefetch();
      } else if (e.touches.length === 2 && pinchRef.current.active) {
        const dist = touchDistance(e.touches[0], e.touches[1]);
        const ratio = dist / pinchRef.current.lastDist;
        pinchRef.current.lastDist = dist;

        const rect = canvas.getBoundingClientRect();
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

        const cam = cameraRef.current;
        const worldBefore = screenToWorld(cam, canvas.width, canvas.height, midX, midY);
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * ratio));

        cameraRef.current = clampCamera({
          x: worldBefore.x - (midX - canvas.width / 2) / newZoom,
          y: worldBefore.y - (midY - canvas.height / 2) / newZoom,
          zoom: newZoom,
        });
        scheduleRefetch();
      }
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length === 0) {
        dragRef.current.active = false;
        pinchRef.current.active = false;
      } else if (e.touches.length === 1) {
        pinchRef.current.active = false;
        dragRef.current = { active: true, lastX: e.touches[0].clientX, lastY: e.touches[0].clientY };
      }
    }

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100vw", height: "100vh", touchAction: "none", cursor: "grab" }}
      />
      {error && (
        <div style={{ position: "fixed", top: 16, left: 16, color: "#e88", fontFamily: "sans-serif" }}>
          {error}
        </div>
      )}
      <SubmitPanel onSubmitted={handleSubmitted} />
    </>
  );
}
