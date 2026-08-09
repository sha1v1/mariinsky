-- Memory World: reusable local 3D representations.
-- Additive and safe for existing sprite-era rows.

alter table memories
  add column if not exists asset_search_terms jsonb not null default '[]',
  add column if not exists semantic_tags jsonb not null default '[]',
  add column if not exists visual_representation jsonb;

-- Give legacy rows an explicit representation without changing their noun
-- or label. The client also contains a compatibility lookup for these rows.
update memories
set visual_representation = jsonb_build_object(
  'assetId', case
    when fallback_archetype in ('bird','cat','deer','butterfly','fish','rabbit','flower','tree','mushroom','book','lamp','chair','clock','camera','cup','shell','backpack','bell','lantern')
      then (case when fallback_archetype = 'cup' then 'mug' else fallback_archetype end) || '_01'
    when fallback_archetype = 'stone' then 'rock_01'
    else 'keepsake_01'
  end,
  'assetPath', case
    when fallback_archetype in ('bird','cat','deer','butterfly','fish','rabbit') then '/models/creatures/' || fallback_archetype || '.glb'
    when fallback_archetype in ('flower','tree','mushroom') then '/models/nature/' || fallback_archetype || '.glb'
    when fallback_archetype = 'stone' then '/models/nature/rock.glb'
    when fallback_archetype in ('shell','backpack','bell','lantern') then '/models/miscellaneous/' || fallback_archetype || '.glb'
    when fallback_archetype in ('book','lamp','chair','clock','camera') then '/models/domestic/' || fallback_archetype || '.glb'
    when fallback_archetype = 'cup' then '/models/domestic/mug.glb'
    else '/models/miscellaneous/keepsake.glb'
  end,
  'retrievalTier', 'keepsake',
  'retrievalScore', 0,
  'scale', 0.65,
  'colorFamily', coalesce(visual_spec->>'primaryColor', 'warm wood'),
  'condition', case when visual_spec->>'condition' in ('new','worn','aged','faded','weathered','pristine') then visual_spec->>'condition' else 'worn' end,
  'materialStyle', 'neutral',
  'animation', case when visual_spec->>'animation' in ('still','gentle_sway','slow_breathing','bob','pulse','flicker','drift') then visual_spec->>'animation' else 'still' end
)
where visual_representation is null;

alter table memories alter column visual_representation set not null;

alter table memories drop constraint if exists memories_render_status_check;
alter table memories add constraint memories_render_status_check
  check (render_status in ('local_3d','pending','generated','fallback','failed'));
alter table memories alter column render_status set default 'local_3d';
