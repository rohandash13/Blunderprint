create table game (
  id text primary key,
  white text not null,
  black text not null,
  white_rating int,
  black_rating int,
  perf text,
  result text,
  played_at timestamptz
);

create table analysis_run (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  engine text not null,
  depth int not null,
  status text not null default 'RUNNING',   -- RUNNING | SCORING | DONE
  created_at timestamptz not null default now()
);

create table move (
  id bigserial primary key,
  run_id uuid not null references analysis_run(id),
  game_id text not null references game(id),
  ply int not null,
  fullmove int not null,
  mover text not null,                       -- 'w' | 'b'
  rating int,
  before_fen text not null,
  before_key text not null,
  after_key text not null,
  played_uci text not null,
  played_san text not null,
  clock_cs int,
  unique (run_id, game_id, ply)
);
create index move_run on move (run_id);

create table eval_cache (
  fen_key text not null,
  engine text not null,
  depth int not null,
  multipv int not null default 1,
  best_uci text,
  score_cp int not null,                     -- side-to-move perspective
  pv text,
  primary key (fen_key, engine, depth, multipv)
);

create table eval_job (
  id bigserial primary key,
  fen_key text not null,
  engine text not null,
  depth int not null,
  status text not null default 'PENDING',    -- PENDING | RUNNING | DONE | FAILED
  attempts int not null default 0,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (fen_key, engine, depth)
);
create index eval_job_pending on eval_job (id) where status = 'PENDING';

create table move_analysis (
  move_id bigint primary key references move(id),
  cpl int not null,
  best_uci text,
  p_played double precision,
  tags text[] not null default '{}'
);
