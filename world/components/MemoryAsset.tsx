import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { ASSET_REGISTRY } from "../lib/assetRegistry.ts";
import { applyAppearance } from "../lib/appearance3d.ts";
import type { AppearanceSpec, BehaviorAnimation } from "../lib/types.ts";

interface MemoryAssetProps {
  id: string;
  assetId: string;
  assetPath?: string;
  appearance: AppearanceSpec;
  animation: BehaviorAnimation;
  scale: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  onSelect?: () => void;
}

function phaseFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % 1000) / 1000 * Math.PI * 2;
}

export default function MemoryAsset({ id, assetId, assetPath, appearance, animation, scale, position, rotation, onSelect }: MemoryAssetProps) {
  const registryAsset = ASSET_REGISTRY.find((asset) => asset.id === assetId) ?? ASSET_REGISTRY.at(-1)!;
  const path = assetPath ?? registryAsset.path;
  const gltf = useGLTF(path);
  const scene = useMemo(() => {
    const clone = cloneSkeleton(gltf.scene);
    // SkeletonUtils remaps each SkinnedMesh to its own cloned bones, but
    // bounds must be evaluated only after those bone matrices are current.
    // Otherwise some imported animals get a bogus vertical offset and
    // disappear below/above the world floor.
    clone.updateMatrixWorld(true);
    clone.traverse((child) => {
      if (!(child instanceof THREE.SkinnedMesh)) return;
      child.skeleton.pose();
      child.skeleton.update();
      child.computeBoundingBox();
    });
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    if (Number.isFinite(bounds.min.y)) clone.position.y -= bounds.min.y;
    return clone;
  }, [gltf.scene]);
  const group = useRef<THREE.Group>(null);
  const phase = useMemo(() => phaseFor(id), [id]);

  useEffect(() => applyAppearance(scene, appearance, registryAsset.id), [scene, appearance, registryAsset.id]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime + phase;
    group.current.rotation.z = rotation?.[2] ?? 0;
    group.current.position.y = position[1];
    group.current.scale.setScalar(scale);
    if (animation === "gentle_sway") group.current.rotation.z += Math.sin(t * 0.75) * 0.06;
    if (animation === "slow_breathing") group.current.scale.setScalar(scale * (1 + Math.sin(t * 0.9) * 0.035));
    if (animation === "bob" || animation === "drift") group.current.position.y += Math.sin(t * 1.1) * 0.09;
    if (animation === "pulse") group.current.scale.setScalar(scale * (1 + Math.sin(t * 1.7) * 0.055));
    if (animation === "flicker") {
      scene.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissive.copy(child.material.color);
          child.material.emissiveIntensity = 0.06 + Math.abs(Math.sin(t * 4.5)) * 0.18;
        }
      });
    }
  });

  return (
    <group
      ref={group}
      position={position}
      rotation={rotation}
      scale={scale}
      onClick={(event) => { event.stopPropagation(); onSelect?.(); }}
    >
      <primitive object={scene} />
    </group>
  );
}

for (const asset of ASSET_REGISTRY) useGLTF.preload(asset.path);
