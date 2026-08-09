import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import SubmitPanel from "./SubmitPanel.tsx";
import MemoryAsset from "./MemoryAsset.tsx";
import DioramaStructure from "./DioramaStructure.tsx";
import { anchorPosition, WORLD_TO_SCENE } from "../lib/sceneCoordinates.ts";
import { ASSET_REGISTRY, SCALE_MULTIPLIERS } from "../lib/assetRegistry.ts";
import type { AppearanceSpec, BehaviorAnimation, StructureRow, VisualRepresentation } from "../lib/types.ts";

interface WorldObjectView {
  id: string;
  x: number;
  y: number;
  noun: string;
  label: string;
  epitaph: string;
  input_type?: "text" | "photo" | "voice" | "video";
  input_url?: string | null;
  raw_text?: string | null;
  fallback_archetype: string;
  entity_kind?: string | null;
  structure_id?: string | null;
  anchor_id?: string | null;
  visual_spec?: Record<string, unknown>;
  visual_representation?: VisualRepresentation | null;
}

interface WorldResponse {
  objects: WorldObjectView[];
  structures: StructureRow[];
}

function legacyAsset(object: WorldObjectView) {
  return ASSET_REGISTRY.find((asset) => asset.id === `${object.fallback_archetype}_01`)
    ?? ASSET_REGISTRY.find((asset) => asset.semanticTags.includes(object.fallback_archetype))
    ?? ASSET_REGISTRY.at(-1)!;
}

function objectTransform(object: WorldObjectView, structures: Map<string, StructureRow>): {
  position: [number, number, number]; rotation?: [number, number, number]; maxScale?: number;
} {
  const structure = object.structure_id ? structures.get(object.structure_id) : undefined;
  const anchor = structure?.anchors.find((candidate) => candidate.id === object.anchor_id);
  if (structure && anchor) {
    const local = anchorPosition(anchor, structure.template_id);
    return {
      position: [structure.x * WORLD_TO_SCENE + local[0], local[1], structure.y * WORLD_TO_SCENE + local[2]],
      rotation: anchor.rotation ? [anchor.rotation.x, anchor.rotation.y, anchor.rotation.z] : undefined,
      maxScale: anchor.maxScale,
    };
  }
  return { position: [object.x * WORLD_TO_SCENE, 0.08, object.y * WORLD_TO_SCENE] };
}

function MemoryObject({ object, structures, onSelect }: {
  object: WorldObjectView;
  structures: Map<string, StructureRow>;
  onSelect: () => void;
}) {
  const spec = object.visual_spec ?? {};
  const specAssetId = typeof spec.assetId === "string" ? spec.assetId : undefined;
  const asset = object.visual_representation
    ? ASSET_REGISTRY.find((candidate) => candidate.id === object.visual_representation?.assetId) ?? legacyAsset(object)
    : ASSET_REGISTRY.find((candidate) => candidate.id === specAssetId) ?? legacyAsset(object);
  const representation = object.visual_representation;
  const appearance: AppearanceSpec = {
    colorFamily: representation?.colorFamily ?? String(spec.primaryColor ?? "warm wood"),
    scale: (["tiny", "miniature", "small", "medium", "large"].includes(String(spec.scale)) ? String(spec.scale) : "small") as AppearanceSpec["scale"],
    condition: (["new", "worn", "aged", "faded", "weathered", "pristine"].includes(String(spec.condition)) ? String(spec.condition) : "worn") as AppearanceSpec["condition"],
    materialStyle: representation?.materialStyle ?? (spec.materialStyle as AppearanceSpec["materialStyle"]),
  };
  const transform = objectTransform(object, structures);
  const numericScale = Math.min(
    representation?.scale ?? asset.defaultScale * SCALE_MULTIPLIERS[appearance.scale],
    transform.maxScale ?? Number.POSITIVE_INFINITY,
  );
  const animation = (representation?.animation ?? spec.animation ?? "still") as BehaviorAnimation;

  return (
    <MemoryAsset
      id={object.id}
      assetId={representation?.assetId ?? specAssetId ?? asset.id}
      assetPath={representation?.assetPath ?? (typeof spec.assetPath === "string" ? spec.assetPath : asset.path)}
      appearance={appearance}
      animation={animation}
      scale={numericScale}
      position={transform.position}
      rotation={transform.rotation}
      onSelect={onSelect}
    />
  );
}

function LoadingWorld() {
  return <Html center><div className="world-loading">Gathering the memories…</div></Html>;
}

function Scene({ objects, structures, onSelect }: {
  objects: WorldObjectView[];
  structures: StructureRow[];
  onSelect: (object: WorldObjectView) => void;
}) {
  const structureMap = useMemo(() => new Map(structures.map((structure) => [structure.id, structure])), [structures]);
  return (
    <>
      <color attach="background" args={["#d8cbb4"]} />
      <fog attach="fog" args={["#d8cbb4", 20, 39]} />
      <hemisphereLight args={["#fff1d6", "#7b8068", 1.65]} />
      <directionalLight
        castShadow position={[-8, 14, 9]} intensity={2.6} color="#ffe2b2"
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-15} shadow-camera-right={15} shadow-camera-top={15} shadow-camera-bottom={-15}
      />
      <mesh receiveShadow position={[0, -0.32, 0]}>
        <cylinderGeometry args={[11.6, 12.2, 0.55, 48]} />
        <meshStandardMaterial color="#8c9575" roughness={1} />
      </mesh>
      <mesh receiveShadow position={[0, -0.61, 0]}>
        <cylinderGeometry args={[12.2, 11.8, 0.18, 48]} />
        <meshStandardMaterial color="#6e705f" roughness={1} />
      </mesh>
      {structures.map((structure) => <DioramaStructure key={structure.id} structure={structure} />)}
      {objects.filter((object) => object.entity_kind !== "structure").map((object) => (
        <MemoryObject key={object.id} object={object} structures={structureMap} onSelect={() => onSelect(object)} />
      ))}
      <OrbitControls
        makeDefault enableRotate={false} enablePan enableZoom
        minZoom={30} maxZoom={90} target={[0, 0.2, 0]}
        mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      />
    </>
  );
}

export default function World() {
  const [world, setWorld] = useState<WorldResponse>({ objects: [], structures: [] });
  const [selected, setSelected] = useState<WorldObjectView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchWorld = useCallback(async () => {
    try {
      const response = await fetch("/api/world?x0=-5000&y0=-5000&x1=5000&y1=5000");
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "World request failed");
      setWorld(data as WorldResponse);
      setError(null);
    } catch (cause) {
      console.error("[World] failed to load", cause);
      setError("The world is resting. Try refreshing in a moment.");
    }
  }, []);

  useEffect(() => { void fetchWorld(); }, [fetchWorld]);

  function handleSubmitted(row: Record<string, unknown>) {
    setWorld((current) => ({ ...current, objects: [...current.objects, row as unknown as WorldObjectView] }));
    setSelected(row as unknown as WorldObjectView);
    window.setTimeout(() => { void fetchWorld(); }, 350);
  }

  return (
    <main className="memory-world">
      <header className="world-header">
        <a className="world-back" href="/" aria-label="Return to Mariinsky">← mariinsky</a>
        <div className="world-mark" aria-hidden="true">✦</div>
        <div><p className="world-kicker">A shared place for what we remember</p><h1>Memory World</h1></div>
        <div className="world-count"><strong>{world.objects.length}</strong><span>memories nearby</span></div>
      </header>
      <Canvas
        shadows orthographic dpr={[1, 1.75]}
        camera={{ position: [13, 13, 16], zoom: 52, near: 0.1, far: 100 }}
        onCreated={({ gl, camera }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          camera.lookAt(0, 0.3, 0);
        }}
        onPointerMissed={() => setSelected(null)}
      >
        <Suspense fallback={<LoadingWorld />}>
          <Scene objects={world.objects} structures={world.structures} onSelect={setSelected} />
        </Suspense>
      </Canvas>
      <div className="world-hint">Drag to wander · Scroll to look closer · Select an object to remember</div>
      {selected && (
        <aside className="memory-card">
          <button type="button" aria-label="Close memory" onClick={() => setSelected(null)}>×</button>
          <p className="memory-card-kicker">A memory became</p>
          <h2>{selected.label}</h2>
          {selected.input_url && selected.input_type === "photo" && (
            <img className="memory-card-media" src={selected.input_url} alt="Original contribution" />
          )}
          {selected.input_url && selected.input_type === "video" && (
            <video className="memory-card-media" src={selected.input_url} controls playsInline preload="metadata" />
          )}
          {selected.input_url && selected.input_type === "voice" && (
            <audio className="memory-card-audio" src={selected.input_url} controls preload="metadata" />
          )}
          {selected.raw_text && <p className="memory-card-submission">“{selected.raw_text}”</p>}
          <p className="memory-card-asset">represented by {selected.visual_representation?.assetId.replace(/_\d+$/, "").replace(/_/g, " ") ?? legacyAsset(selected).displayName.toLowerCase()}</p>
        </aside>
      )}
      {error && <div className="world-error">{error}</div>}
      <SubmitPanel onSubmitted={handleSubmitted} />
    </main>
  );
}
