import type { StructureRow } from "../lib/types.ts";
import { WORLD_PALETTE } from "../lib/appearance3d.ts";
import { WORLD_TO_SCENE } from "../lib/sceneCoordinates.ts";

function HouseFurniture() {
  return (
    <>
      <group position={[0.35, 0, 0.15]}>
        <mesh position={[0, 0.95, 0]} castShadow><boxGeometry args={[1.55, 0.14, 0.9]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} roughness={0.86} /></mesh>
        {[[-0.62,-0.32], [0.62,-0.32], [-0.62,0.32], [0.62,0.32]].map(([x,z], i) => <mesh key={i} position={[x,0.475,z]} castShadow><boxGeometry args={[0.11,0.95,0.11]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} /></mesh>)}
      </group>
      <mesh position={[1.78, 1.32, -1.78]} castShadow><boxGeometry args={[0.85, 0.12, 0.28]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} /></mesh>
      <group position={[-1.45, 0, 0.2]}>
        <mesh position={[0, 0.32, 0]} castShadow><boxGeometry args={[0.72, 0.12, 0.72]} /><meshStandardMaterial color={WORLD_PALETTE.burgundy} /></mesh>
        <mesh position={[0, 0.78, 0.3]} castShadow><boxGeometry args={[0.72, 0.82, 0.12]} /><meshStandardMaterial color={WORLD_PALETTE.burgundy} /></mesh>
      </group>
    </>
  );
}

function OfficeFurniture() {
  return (
    <>
      <group position={[0.15, 0, 0.45]}>
        <mesh position={[0, 0.93, 0]} castShadow><boxGeometry args={[2.0, 0.14, 0.78]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} /></mesh>
        <mesh position={[-0.82,0.465,0]} castShadow><boxGeometry args={[0.12,0.93,0.62]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} /></mesh>
        <mesh position={[0.82,0.465,0]} castShadow><boxGeometry args={[0.12,0.93,0.62]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} /></mesh>
      </group>
      <mesh position={[-1.82, 1.29, -1.77]} castShadow><boxGeometry args={[0.9, 0.12, 0.3]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} /></mesh>
      <mesh position={[0.1, 0.46, -0.66]} castShadow><boxGeometry args={[0.68, 0.1, 0.68]} /><meshStandardMaterial color={WORLD_PALETTE.mutedGreen} /></mesh>
      <mesh position={[0.1, 0.92, -0.35]} castShadow><boxGeometry args={[0.68, 0.82, 0.1]} /><meshStandardMaterial color={WORLD_PALETTE.mutedGreen} /></mesh>
    </>
  );
}

export default function DioramaStructure({ structure }: { structure: StructureRow }) {
  const position: [number, number, number] = [structure.x * WORLD_TO_SCENE, 0, structure.y * WORLD_TO_SCENE];
  const office = structure.template_id === "office";
  const windowX = office ? 1.6 : -1.6;
  return (
    <group position={position}>
      <mesh receiveShadow position={[0, -0.08, 0]}><boxGeometry args={[5.2, 0.16, 4.2]} /><meshStandardMaterial color={office ? "#b9b0a2" : WORLD_PALETTE.cream} roughness={0.95} /></mesh>
      <mesh receiveShadow castShadow position={[0, 1.45, -1.98]}><boxGeometry args={[5.2, 3, 0.15]} /><meshStandardMaterial color={office ? "#8a948e" : "#b18a68"} roughness={0.9} /></mesh>
      <mesh receiveShadow castShadow position={[-2.52, 1.45, 0]}><boxGeometry args={[0.15, 3, 4.1]} /><meshStandardMaterial color={office ? "#788681" : "#9b765a"} roughness={0.9} /></mesh>
      <mesh position={[windowX, 1.83, -1.88]}><boxGeometry args={[1.1, 1.15, 0.18]} /><meshStandardMaterial color="#8fb0b2" roughness={0.3} metalness={0.05} /></mesh>
      <mesh position={[windowX, 1.19, -1.72]} castShadow><boxGeometry args={[1.25, 0.12, 0.35]} /><meshStandardMaterial color={WORLD_PALETTE.warmWood} /></mesh>
      {office ? <OfficeFurniture /> : <HouseFurniture />}
      <mesh position={[0, -0.17, 0]} receiveShadow><boxGeometry args={[5.65, 0.08, 4.65]} /><meshStandardMaterial color="#6c675f" roughness={1} /></mesh>
    </group>
  );
}
