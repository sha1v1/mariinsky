// Step 2.3 — screen<->world coordinate helpers, in one place, used by
// World.tsx's rendering/input handling now and by every step after this
// that needs to convert between the two spaces (clicking an object for the
// reveal panel, flying the camera to a newly submitted object, etc).
// Pure functions, no React/DOM deps — client-safe.

export interface Camera {
  x: number; // world-space point currently at the center of the screen
  y: number;
  zoom: number; // screen pixels per world unit
}

export const ZOOM_MIN = 0.08;
export const ZOOM_MAX = 4;
// World content lives within roughly the anchor circle (radius 1200) plus
// jitter/repulsion/composite headroom — clamp panning so you can't drag the
// camera off into empty void indefinitely.
export const PAN_BOUNDS = 2500;

export function clampCamera(camera: Camera): Camera {
  return {
    x: Math.max(-PAN_BOUNDS, Math.min(PAN_BOUNDS, camera.x)),
    y: Math.max(-PAN_BOUNDS, Math.min(PAN_BOUNDS, camera.y)),
    zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camera.zoom)),
  };
}

export function worldToScreen(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  worldX: number,
  worldY: number
): { x: number; y: number } {
  return {
    x: canvasWidth / 2 + (worldX - camera.x) * camera.zoom,
    y: canvasHeight / 2 + (worldY - camera.y) * camera.zoom,
  };
}

export function screenToWorld(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number
): { x: number; y: number } {
  return {
    x: camera.x + (screenX - canvasWidth / 2) / camera.zoom,
    y: camera.y + (screenY - canvasHeight / 2) / camera.zoom,
  };
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Step 3.1 — camera "fly to" easing, used when a freshly-submitted object
// needs the camera to travel there instead of just snapping. Pure math
// (no timers/rAF here) so World.tsx can drive it from its existing render
// loop: call once per frame with the flight's start time, get back the
// camera for *this* frame, and know when to stop calling.
export interface CameraFlight {
  startX: number;
  startY: number;
  startZoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
  startTime: number;
  duration: number;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Returns the interpolated camera for `timeMs`, plus whether the flight has
// reached its target (caller should stop invoking this once done is true).
export function stepCameraFlight(flight: CameraFlight, timeMs: number): { camera: Camera; done: boolean } {
  const t = Math.min(1, (timeMs - flight.startTime) / flight.duration);
  const eased = easeOutCubic(t);
  return {
    camera: clampCamera({
      x: flight.startX + (flight.targetX - flight.startX) * eased,
      y: flight.startY + (flight.targetY - flight.startY) * eased,
      zoom: flight.startZoom + (flight.targetZoom - flight.startZoom) * eased,
    }),
    done: t >= 1,
  };
}

export function viewportBBox(camera: Camera, canvasWidth: number, canvasHeight: number): BBox {
  const halfWorldWidth = canvasWidth / 2 / camera.zoom;
  const halfWorldHeight = canvasHeight / 2 / camera.zoom;
  return {
    x0: camera.x - halfWorldWidth,
    y0: camera.y - halfWorldHeight,
    x1: camera.x + halfWorldWidth,
    y1: camera.y + halfWorldHeight,
  };
}
