alter table move_analysis
  add column win_drop double precision,
  add column best_quiet boolean,
  add column best_free_material boolean,
  add column find_depth int,
  add column only_move boolean,
  add column difficulty_elo int;
