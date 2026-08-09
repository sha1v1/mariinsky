/**
 * Generates Memory World's small, original CC0 low-poly GLB library.
 *
 * These models deliberately use only simple geometry and a shared palette.
 * They are lightweight, easy to recolour, and deterministic. Re-run with:
 *   node scripts/generate-lowpoly-models.mjs
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    result = null;
    onloadend = null;
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((value) => {
        this.result = value;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((value) => {
        const base64 = Buffer.from(value).toString("base64");
        this.result = `data:${blob.type};base64,${base64}`;
        this.onloadend?.();
      });
    }
  };
}

const C = {
  wood: "#8a654a", cream: "#d9c5a1", green: "#7b8c62", burgundy: "#8a5149",
  brass: "#9c7a45", stone: "#958d80", dark: "#403b38", water: "#7aa5aa",
  leaf: "#657653", white: "#eee5d5", orange: "#c47b4e", blue: "#71869c",
};

const matCache = new Map();
function mat(color, roughness = 0.82, metalness = 0) {
  const key = `${color}:${roughness}:${metalness}`;
  if (!matCache.has(key)) {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const paletteName = Object.entries(C).find(([, value]) => value.toLowerCase() === color.toLowerCase())?.[0] ?? "custom";
    material.name = `mw-${paletteName}`;
    matCache.set(key, material);
  }
  return matCache.get(key);
}

function mesh(geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], material) {
  const value = new THREE.Mesh(geometry, material ?? mat(color));
  value.position.set(...position);
  value.rotation.set(...rotation);
  value.scale.set(...scale);
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

const box = (size, color, position, rotation, material) => mesh(new THREE.BoxGeometry(...size), color, position, rotation, [1, 1, 1], material);
const sphere = (radius, color, position, scale = [1, 1, 1]) => mesh(new THREE.IcosahedronGeometry(radius, 1), color, position, [0, 0, 0], scale);
const cylinder = (r1, r2, height, color, position, rotation, segments = 8, material) => mesh(new THREE.CylinderGeometry(r1, r2, height, segments), color, position, rotation, [1, 1, 1], material);
const cone = (radius, height, color, position, rotation, segments = 8) => mesh(new THREE.ConeGeometry(radius, height, segments), color, position, rotation);
const torus = (radius, tube, color, position, rotation) => mesh(new THREE.TorusGeometry(radius, tube, 6, 12), color, position, rotation);

function group(...parts) {
  const g = new THREE.Group();
  g.add(...parts.flat());
  return g;
}

function fourLegs(x, z, height, color = C.wood) {
  return [[-x, -z], [x, -z], [-x, z], [x, z]].map(([px, pz]) => box([0.12, height, 0.12], color, [px, height / 2, pz]));
}

function animal(color, ear = true, antlers = false) {
  const parts = [
    sphere(0.42, color, [0, 0.65, 0], [1.35, 0.85, 0.72]),
    sphere(0.28, color, [0.5, 0.92, 0], [0.8, 0.9, 0.8]),
    ...[[-0.28, -0.2], [0.28, -0.2], [-0.28, 0.2], [0.28, 0.2]].map(([x, z]) => cylinder(0.055, 0.07, 0.48, color, [x, 0.28, z])),
    sphere(0.035, C.dark, [0.7, 0.98, -0.13]),
  ];
  if (ear) parts.push(cone(0.13, 0.3, color, [0.47, 1.23, -0.17], [0, 0, -0.25]), cone(0.13, 0.3, color, [0.47, 1.23, 0.17], [0, 0, -0.25]));
  if (antlers) parts.push(
    cylinder(0.025, 0.035, 0.42, C.brass, [0.42, 1.38, -0.13], [0, 0, -0.2], 6),
    cylinder(0.025, 0.035, 0.42, C.brass, [0.42, 1.38, 0.13], [0, 0, -0.2], 6),
  );
  return group(parts);
}

const makers = {
  mug: () => group(cylinder(0.32, 0.28, 0.55, C.cream, [0, 0.28, 0], undefined, 12), torus(0.27, 0.065, C.cream, [0.32, 0.33, 0], [Math.PI / 2, 0, 0])),
  book: () => group(box([0.85, 0.14, 0.58], C.burgundy, [0, 0.13, 0]), box([0.76, 0.1, 0.55], C.cream, [0.02, 0.14, 0])),
  lamp: () => group(cylinder(0.28, 0.34, 0.12, C.brass, [0, 0.06, 0], undefined, 12), cylinder(0.055, 0.055, 0.8, C.brass, [0, 0.48, 0], undefined, 8), cone(0.42, 0.48, C.cream, [0, 0.92, 0], [0, 0, Math.PI])),
  chair: () => group(box([0.75, 0.12, 0.72], C.wood, [0, 0.62, 0]), box([0.75, 0.72, 0.12], C.wood, [0, 1.0, 0.3]), fourLegs(0.29, 0.27, 0.58)),
  table: () => group(box([1.55, 0.16, 0.95], C.wood, [0, 0.86, 0]), fourLegs(0.62, 0.34, 0.82)),
  radio: () => group(box([1.15, 0.68, 0.42], C.wood, [0, 0.36, 0]), cylinder(0.24, 0.24, 0.025, C.dark, [-0.28, 0.37, -0.225], [Math.PI / 2, 0, 0], 16), cylinder(0.07, 0.07, 0.04, C.brass, [0.35, 0.48, -0.23], [Math.PI / 2, 0, 0], 10)),
  clock: () => group(cylinder(0.48, 0.48, 0.18, C.cream, [0, 0.5, 0], [Math.PI / 2, 0, 0], 16), cylinder(0.035, 0.035, 0.3, C.dark, [0, 0.56, -0.105], [0, 0, -0.65], 6), cylinder(0.03, 0.03, 0.22, C.dark, [0.07, 0.58, -0.11], [0, 0, 0.8], 6)),
  camera: () => group(box([1.0, 0.62, 0.45], C.dark, [0, 0.38, 0]), cylinder(0.26, 0.3, 0.32, C.brass, [0, 0.4, -0.35], [Math.PI / 2, 0, 0], 12), box([0.3, 0.18, 0.28], C.dark, [-0.22, 0.76, 0])),
  plant: () => group(cylinder(0.35, 0.25, 0.42, C.burgundy, [0, 0.21, 0], undefined, 10), ...[-0.35, 0, 0.35].map((r) => sphere(0.28, C.leaf, [Math.sin(r) * 0.28, 0.72 + Math.cos(r) * 0.13, r], [0.55, 1.4, 0.32]))),
  toy: () => group(box([0.72, 0.35, 0.4], C.burgundy, [0, 0.35, 0]), sphere(0.17, C.brass, [-0.26, 0.16, -0.23]), sphere(0.17, C.brass, [0.26, 0.16, -0.23]), box([0.28, 0.28, 0.3], C.cream, [0.25, 0.64, 0])),
  bed: () => group(box([1.3, 0.22, 2.0], C.wood, [0, 0.38, 0]), box([1.18, 0.24, 1.82], C.cream, [0, 0.58, -0.03]), box([1.3, 0.95, 0.15], C.wood, [0, 0.76, 0.92])),
  bookcase: () => group(box([1.3, 1.8, 0.22], C.wood, [0, 0.9, 0.18]), box([0.16, 1.8, 0.55], C.wood, [-0.58, 0.9, 0]), box([0.16, 1.8, 0.55], C.wood, [0.58, 0.9, 0]), ...[0.18, 0.72, 1.26, 1.72].map((y) => box([1.2, 0.1, 0.55], C.wood, [0, y, 0]))),
  tree: () => group(cylinder(0.2, 0.3, 1.55, C.wood, [0, 0.78, 0], undefined, 8), sphere(0.72, C.leaf, [0, 1.75, 0]), sphere(0.52, C.green, [0.48, 1.55, 0.1])),
  flower: () => group(cylinder(0.035, 0.045, 0.85, C.green, [0, 0.43, 0], undefined, 6), ...Array.from({ length: 6 }, (_, i) => sphere(0.17, C.burgundy, [Math.cos(i * Math.PI / 3) * 0.22, 0.96, Math.sin(i * Math.PI / 3) * 0.22], [1, 0.45, 1])), sphere(0.12, C.brass, [0, 0.97, 0])),
  mushroom: () => group(cylinder(0.16, 0.23, 0.52, C.cream, [0, 0.26, 0], undefined, 8), sphere(0.43, C.burgundy, [0, 0.58, 0], [1, 0.45, 1])),
  rock: () => sphere(0.58, C.stone, [0, 0.42, 0], [1.3, 0.72, 0.95]),
  pond: () => group(
    mesh(new THREE.CylinderGeometry(1.02, 1.08, 0.07, 16), C.dark, [0, 0.035, 0], [0, 0, 0], [1.25, 1, 0.85], mat(C.dark, 1, 0)),
    mesh(new THREE.TorusGeometry(0.9, 0.2, 5, 16), C.stone, [0, 0.085, 0], [Math.PI / 2, 0, 0], [1.25, 0.85, 0.25]),
    mesh(new THREE.CylinderGeometry(0.84, 0.87, 0.05, 20), C.water, [0, 0.07, 0], [0, 0, 0], [1.3, 1, 0.9], mat(C.water, 0.18, 0.04)),
    sphere(0.18, C.stone, [1.03, 0.12, 0.16], [1.2, 0.5, 0.85]),
    sphere(0.14, C.stone, [-0.88, 0.1, -0.52], [1.1, 0.5, 0.9]),
    sphere(0.11, C.stone, [-1.03, 0.085, -0.28], [1.15, 0.48, 0.9]),
    cylinder(0.13, 0.13, 0.014, C.leaf, [0.28, 0.103, 0.08], undefined, 10),
    cylinder(0.09, 0.09, 0.014, C.leaf, [-0.34, 0.103, -0.14], undefined, 9),
    sphere(0.035, C.burgundy, [0.3, 0.13, 0.08], [1, 0.55, 1]),
    cylinder(0.018, 0.024, 0.48, C.green, [-0.64, 0.32, -0.62], [0, 0, -0.12], 5),
    cylinder(0.018, 0.024, 0.4, C.green, [-0.52, 0.28, -0.66], [0, 0, 0.15], 5),
    cylinder(0.018, 0.024, 0.34, C.green, [-0.75, 0.25, -0.55], [0, 0, -0.25], 5)
  ),
  bird: () => group(sphere(0.38, C.blue, [0, 0.52, 0], [1.2, 0.85, 0.8]), sphere(0.24, C.blue, [0.35, 0.72, 0]), cone(0.12, 0.32, C.brass, [0.61, 0.72, 0], [0, 0, -Math.PI / 2], 6)),
  deer: () => animal(C.burgundy, true, true),
  rabbit: () => group(animal(C.cream, false), cone(0.13, 0.62, C.cream, [0.46, 1.33, -0.14], [0, 0, -0.12]), cone(0.13, 0.62, C.cream, [0.46, 1.33, 0.14], [0, 0, -0.12])),
  cat: () => group(animal(C.orange, true), cone(0.12, 0.45, C.orange, [-0.62, 0.82, 0], [0, 0, -1.1], 7)),
  fish: () => group(sphere(0.42, C.blue, [0, 0.5, 0], [1.45, 0.72, 0.55]), cone(0.34, 0.5, C.blue, [-0.68, 0.5, 0], [0, 0, Math.PI / 2], 6), sphere(0.035, C.dark, [0.38, 0.61, -0.2])),
  butterfly: () => group(sphere(0.12, C.dark, [0, 0.55, 0], [0.5, 1.7, 0.5]), sphere(0.42, C.burgundy, [-0.3, 0.64, 0], [0.8, 0.18, 1.25]), sphere(0.42, C.burgundy, [0.3, 0.64, 0], [0.8, 0.18, 1.25])),
  umbrella: () => group(cylinder(0.035, 0.04, 1.25, C.dark, [0, 0.64, 0], undefined, 7), sphere(0.76, C.burgundy, [0, 1.28, 0], [1, 0.35, 1]), torus(0.16, 0.035, C.dark, [0.14, 0.08, 0], [0, 0, 0])),
  backpack: () => group(box([0.82, 1.0, 0.44], C.green, [0, 0.58, 0]), box([0.68, 0.34, 0.18], C.burgundy, [0, 0.38, -0.29]), torus(0.24, 0.055, C.green, [0, 1.1, 0.12], [Math.PI / 2, 0, 0])),
  bell: () => group(cone(0.46, 0.72, C.brass, [0, 0.52, 0], [0, 0, Math.PI], 12), sphere(0.11, C.brass, [0, 0.12, 0]), torus(0.12, 0.035, C.brass, [0, 0.96, 0], [Math.PI / 2, 0, 0])),
  lantern: () => group(box([0.55, 0.82, 0.55], C.dark, [0, 0.52, 0]), box([0.38, 0.58, 0.38], C.brass, [0, 0.54, 0], undefined, mat(C.brass, 0.4, 0.2)), torus(0.28, 0.04, C.dark, [0, 1.0, 0], [0, 0, 0])),
  shell: () => group(...Array.from({ length: 7 }, (_, i) => sphere(0.2 - i * 0.016, C.cream, [-0.48 + i * 0.15, 0.2 + i * 0.025, 0], [1, 0.75, 0.45]))),
  keepsake: () => group(cylinder(0.55, 0.48, 0.22, C.brass, [0, 0.12, 0], undefined, 10), sphere(0.22, C.burgundy, [0, 0.33, 0], [1, 0.35, 1])),
};

const categories = {
  domestic: ["mug", "book", "lamp", "chair", "table", "radio", "clock", "camera", "plant", "toy", "bed", "bookcase"],
  nature: ["tree", "flower", "mushroom", "rock", "pond"],
  creatures: ["bird", "deer", "rabbit", "cat", "fish", "butterfly"],
  miscellaneous: ["umbrella", "backpack", "bell", "lantern", "shell", "keepsake"],
};

const exporter = new GLTFExporter();
function exportGlb(object) {
  return new Promise((resolveExport, rejectExport) => {
    exporter.parse(object, resolveExport, rejectExport, { binary: true, onlyVisible: true });
  });
}

for (const [category, ids] of Object.entries(categories)) {
  for (const id of ids) {
    const object = makers[id]();
    object.name = id;
    const path = resolve(`public/models/${category}/${id}.glb`);
    mkdirSync(dirname(path), { recursive: true });
    const glb = await exportGlb(object);
    writeFileSync(path, Buffer.from(glb));
    console.log(`generated ${path}`);
  }
}
