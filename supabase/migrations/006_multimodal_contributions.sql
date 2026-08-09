-- Durable original media plus image/audio/video contribution metadata.

alter table memories
  add column if not exists media_metadata jsonb;

alter table memories drop constraint if exists memories_input_type_check;
alter table memories add constraint memories_input_type_check
  check (input_type in ('text', 'photo', 'voice', 'video'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contributions',
  'contributions',
  true,
  104857600,
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/aac','audio/ogg','audio/webm','audio/flac',
    'video/mp4','video/mpeg','video/quicktime','video/webm','video/3gpp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
