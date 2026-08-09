import * as THREE from "three";
import type { AppearanceSpec } from "./types.ts";

export const WORLD_PALETTE = {
  warmWood: "#8A654A",
  cream: "#D9C5A1",
  mutedGreen: "#7B8C62",
  burgundy: "#8A5149",
  brass: "#9C7A45",
  stone: "#958D80",
  dustyBlue: "#71869C",
  plum: "#76506F",
  water: "#6F9FA5",
} as const;

function paletteColor(description?: string): THREE.Color | null {
  if (!description) return null;
  const value = description.toLowerCase();
  if (/purple|violet|lilac|plum/.test(value)) return new THREE.Color(WORLD_PALETTE.plum);
  if (/red|burgundy|crimson|rose|pink/.test(value)) return new THREE.Color(WORLD_PALETTE.burgundy);
  if (/green|moss|sage|leaf/.test(value)) return new THREE.Color(WORLD_PALETTE.mutedGreen);
  if (/blue|slate|water|sky/.test(value)) return new THREE.Color(WORLD_PALETTE.dustyBlue);
  if (/brass|gold|yellow|amber|ochre/.test(value)) return new THREE.Color(WORLD_PALETTE.brass);
  if (/brown|wood|umber/.test(value)) return new THREE.Color(WORLD_PALETTE.warmWood);
  if (/grey|gray|stone|charcoal|black/.test(value)) return new THREE.Color(WORLD_PALETTE.stone);
  if (/cream|ivory|white|beige/.test(value)) return new THREE.Color(WORLD_PALETTE.cream);
  if (/^#[0-9a-f]{6}$/i.test(description)) return new THREE.Color(description);
  return null;
}

function styleMaterial(material: THREE.MeshStandardMaterial, appearance: AppearanceSpec, assetId?: string): void {
  const target = paletteColor(appearance.colorFamily);
  const role = material.name.toLowerCase();
  const isWater = role === "mw-water";
  const preservePondPalette = assetId === "pond_01";

  if (isWater) material.color.set(WORLD_PALETTE.water);
  else if (preservePondPalette && role === "mw-stone") material.color.set(WORLD_PALETTE.stone);
  else if (preservePondPalette && role === "mw-green") material.color.set(WORLD_PALETTE.mutedGreen);
  else if (target && role !== "mw-dark" && !preservePondPalette) material.color.lerp(target, 0.68);

  const hsl = { h: 0, s: 0, l: 0 };
  material.color.getHSL(hsl);
  if (appearance.condition === "aged" || appearance.condition === "worn") {
    material.color.setHSL(hsl.h, hsl.s * 0.72, hsl.l * 0.86);
    material.roughness = Math.max(material.roughness, 0.78);
  } else if (appearance.condition === "faded") {
    material.color.setHSL(hsl.h, hsl.s * 0.5, Math.min(1, hsl.l * 1.04));
  } else if (appearance.condition === "weathered") {
    material.color.setHSL(hsl.h, hsl.s * 0.62, hsl.l * 0.82);
    material.roughness = Math.max(material.roughness, 0.9);
  } else if (appearance.condition === "pristine" || appearance.condition === "new") {
    material.color.setHSL(hsl.h, Math.min(1, hsl.s * 1.04), Math.min(1, hsl.l * 1.08));
  }

  switch (appearance.materialStyle) {
    case "metallic": material.metalness = 0.72; material.roughness = 0.32; break;
    case "glossy": material.roughness = 0.2; break;
    case "rough": material.roughness = 0.96; break;
    case "soft": material.roughness = 1; material.metalness = 0; break;
    case "matte": material.roughness = 0.86; material.metalness = 0; break;
    default: break;
  }
  if (isWater) {
    material.color.set(WORLD_PALETTE.water);
    material.roughness = 0.18;
    material.metalness = 0.04;
    material.emissive.set("#183b3d");
    material.emissiveIntensity = 0.08;
  } else if (preservePondPalette && role === "mw-stone") {
    material.roughness = 0.96;
  }
  material.needsUpdate = true;
}

/** Clone/material-normalize a loaded asset without touching its geometry. */
export function applyAppearance(object: THREE.Object3D, appearance: AppearanceSpec, assetId?: string): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const source = Array.isArray(child.material) ? child.material : [child.material];
    const materials = source.map((value) => {
      const cloned = value.clone();
      if (cloned instanceof THREE.MeshStandardMaterial) styleMaterial(cloned, appearance, assetId);
      return cloned;
    });
    child.material = Array.isArray(child.material) ? materials : materials[0];
  });
}
