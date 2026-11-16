-- Personlig lässtatus för mötesdokument.
-- Varje ledamot kan bara registrera och läsa sin egen status.
-- Administratören kan läsa samtliga aktiva styrelseledamöters status.

create table if not exists public.meeting_document_reads (
  document_id uuid not null references public.meeting_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint meeting_document_reads_pkey primary key (document_id, user_id)
);

create index if not exists meeting_document_reads_user_id_idx
  on public.meeting_document_reads (user_id);

alter table public.meeting_document_reads enable row level security;

revoke all on public.meeting_document_reads from anon;
grant select, insert, update on public.meeting_document_reads to authenticated;
revoke delete on public.meeting_document_reads from authenticated;

drop policy if exists "Users read own document status or admin reads all"
  on public.meeting_document_reads;
create policy "Users read own document status or admin reads all"
  on public.meeting_document_reads
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or private.is_admin_board_member()
  );

drop policy if exists "Users insert own document read status"
  on public.meeting_document_reads;
create policy "Users insert own document read status"
  on public.meeting_document_reads
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users update own document read status"
  on public.meeting_document_reads;
create policy "Users update own document read status"
  on public.meeting_document_reads
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
