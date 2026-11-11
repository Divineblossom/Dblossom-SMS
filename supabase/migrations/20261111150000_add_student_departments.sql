alter table public.students
  add column if not exists department text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'students_department_allowed'
      and conrelid = 'public.students'::regclass
  ) then
    alter table public.students
      add constraint students_department_allowed
      check (department is null or department in (
        'Science Department',
        'Humanity Department',
        'Business Department'
      ));
  end if;
end $$;
