create or replace function public.promote_students_by_term(
  p_term_id uuid,
  p_promoted_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_promoted_count integer := 0;
begin
  select session_id into v_session_id
  from public.terms
  where id = p_term_id;

  if not found then
    raise exception 'The selected term was not found.';
  end if;
  if v_session_id is null then
    raise exception 'The selected term is not linked to an academic session.';
  end if;

  -- Serialize promotion requests for the same term to prevent double promotion.
  perform pg_advisory_xact_lock(hashtext('student-promotions-' || p_term_id::text));

  with class_pairs as (
    select current_class.id as from_class_id, next_class.id as to_class_id
    from public.classes current_class
    join public.classes next_class
      on regexp_replace(lower(next_class.name), '\s+', '', 'g') =
        case regexp_replace(lower(current_class.name), '\s+', '', 'g')
          when 'primary1' then 'primary2'
          when 'primary2' then 'primary3'
          when 'primary3' then 'primary4'
          when 'primary4' then 'primary5'
          when 'primary5' then 'jss1'
          when 'jss1' then 'jss2'
          when 'jss2' then 'jss3'
          when 'jss3' then 'ss1'
          when 'ss1' then 'ss2'
          when 'ss2' then 'ss3'
          else null
        end
    where current_class.is_active = true and next_class.is_active = true
  ),
  student_averages as (
    select
      r.student_id,
      s.class_id as from_class_id,
      avg(coalesce(r.total_score, coalesce(r.ca_score, 0) + coalesce(r.exam_score, 0))) as overall_average
    from public.results r
    join public.students s on s.id = r.student_id
    where r.term_id = p_term_id
      and s.status = 'active'
      and s.class_id is not null
    group by r.student_id, s.class_id
  ),
  eligible as (
    select a.student_id, a.from_class_id, cp.to_class_id, a.overall_average
    from student_averages a
    join class_pairs cp on cp.from_class_id = a.from_class_id
    where a.overall_average >= 50
      and not exists (
        select 1
        from public.student_promotions sp
        where sp.student_id = a.student_id
          and sp.from_session_id = v_session_id
      )
  ),
  moved as (
    update public.students s
    set class_id = e.to_class_id
    from eligible e
    where s.id = e.student_id
      and s.class_id = e.from_class_id
    returning s.id as student_id, e.from_class_id, e.to_class_id
  ),
  logged as (
    insert into public.student_promotions
      (student_id, from_class_id, to_class_id, from_session_id, status, promoted_at, promoted_by)
    select
      m.student_id, m.from_class_id, m.to_class_id, v_session_id, 'Promoted', now(), p_promoted_by
    from moved m
    returning id
  )
  select count(*) into v_promoted_count from logged;

  return jsonb_build_object(
    'ok', true,
    'term_id', p_term_id,
    'session_id', v_session_id,
    'threshold_percent', 50,
    'promoted_count', v_promoted_count
  );
end;
$$;

-- This function changes student class assignments; only the server-side service role may execute it.
revoke all on function public.promote_students_by_term(uuid, uuid) from public, anon, authenticated;
grant execute on function public.promote_students_by_term(uuid, uuid) to service_role;
