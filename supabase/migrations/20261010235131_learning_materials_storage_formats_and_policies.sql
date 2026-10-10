-- Public learning-materials bucket and role-aware access policies.
-- Teachers upload to a folder named with their teacher record ID; students/parents can access public resource URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learning-materials','learning-materials',true,26214400,array[
'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/rtf','application/vnd.oasis.opendocument.text','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.oasis.opendocument.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.oasis.opendocument.spreadsheet','text/csv','image/jpeg','image/png','image/webp','image/gif','image/bmp','image/svg+xml','text/plain','text/markdown','audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm','video/quicktime','application/zip','application/x-rar-compressed','application/x-7z-compressed','application/octet-stream'
])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Active teachers upload learning materials" on storage.objects;
drop policy if exists "Teachers upload learning materials" on storage.objects;
create policy "Teachers upload learning materials" on storage.objects for insert to authenticated
with check (bucket_id='learning-materials' and exists(select 1 from public.teachers t where t.profile_id=auth.uid() and lower(coalesce(t.status,'active'))='active' and (storage.foldername(name))[1]=t.id::text));

drop policy if exists "Authenticated users read learning materials" on storage.objects;
create policy "Authenticated users read learning materials" on storage.objects for select to authenticated using(bucket_id='learning-materials');

drop policy if exists "Teachers update learning materials" on storage.objects;
create policy "Teachers update learning materials" on storage.objects for update to authenticated
using(bucket_id='learning-materials' and exists(select 1 from public.teachers t where t.profile_id=auth.uid() and lower(coalesce(t.status,'active'))='active' and (storage.foldername(name))[1]=t.id::text))
with check(bucket_id='learning-materials' and exists(select 1 from public.teachers t where t.profile_id=auth.uid() and lower(coalesce(t.status,'active'))='active' and (storage.foldername(name))[1]=t.id::text));

drop policy if exists "Teachers delete learning materials" on storage.objects;
create policy "Teachers delete learning materials" on storage.objects for delete to authenticated
using(bucket_id='learning-materials' and exists(select 1 from public.teachers t where t.profile_id=auth.uid() and lower(coalesce(t.status,'active'))='active' and (storage.foldername(name))[1]=t.id::text));
