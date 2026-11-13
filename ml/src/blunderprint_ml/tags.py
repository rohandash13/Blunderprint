"""Rule-based, explainable mistake tags."""
import chess

TAG_MIN_CPL = 30
_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def _hanging_after(board_before: chess.Board, move: chess.Move) -> bool:
    b = board_before.copy()
    mover = b.turn
    b.push(move)
    opp = not mover
    for sq, piece in b.piece_map().items():
        if piece.color != mover or piece.piece_type in (chess.KING, chess.PAWN):
            continue
        attackers = b.attackers(opp, sq)
        if not attackers:
            continue
        defenders = b.attackers(mover, sq)
        cheapest = min(_VALUE.get(b.piece_type_at(a), 100) for a in attackers)   # a king attacker counts as 100
        if not defenders or cheapest < _VALUE[piece.piece_type]:
            return True
    return False


def _forcing(board: chess.Board, move: chess.Move) -> bool:
    return board.is_capture(move) or board.gives_check(move)


def is_quiet(board: chess.Board, move: chess.Move) -> bool:
    """Not a capture, not a check, not a promotion."""
    return not (board.is_capture(move) or board.gives_check(move) or move.promotion)


def _balance(board: chess.Board, color: bool) -> int:
    total = 0
    for piece in board.piece_map().values():
        v = _VALUE.get(piece.piece_type, 0)
        total += v if piece.color == color else -v
    return total


def best_line_is_tactical(board: chess.Board, best_pv: str | None, best: chess.Move | None = None) -> bool:
    """The best move is a check evasion, or its line (<= 4 plies) mates or wins >= 2 material.

    Material is only compared after an opponent reply, so a sacrifice that is recaptured is not a gain.
    """
    if board.is_check():
        return True
    if not best_pv:
        return False
    if best is not None and best_pv.split()[0] != best.uci():
        return False          # the line belongs to another move
    mover = board.turn
    start = _balance(board, mover)
    b = board.copy()
    for ply, uci in enumerate(best_pv.split()[:4], 1):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in b.legal_moves:
            break
        b.push(move)
        if ply % 2 == 1 and b.is_checkmate():
            return True
        if ply % 2 == 0 and _balance(b, mover) - start >= 2:
            return True
    return False


def best_is_quiet(board: chess.Board, best: chess.Move, best_pv: str | None = None) -> bool:
    """Quiet by move type and not part of a tactic (check evasion, forced mate, material win)."""
    return is_quiet(board, best) and not best_line_is_tactical(board, best_pv, best)


def wins_free_material(board: chess.Board, move: chess.Move) -> bool:
    """Mate in one, or a capture of an undefended piece / a clearly favourable trade (gain >= 2)."""
    capturing = board.piece_type_at(move.from_square)
    is_capture = board.is_capture(move)
    captured = None
    if is_capture:
        captured = chess.PAWN if board.is_en_passant(move) else board.piece_type_at(move.to_square)
    b = board.copy()
    b.push(move)
    if b.is_checkmate():
        return True
    if not is_capture:
        return False
    # Defended means a legal recapture exists (pins and king-adjacent protection are respected).
    if not any(m.to_square == move.to_square for m in b.legal_moves):
        return True
    return _VALUE.get(captured, 0) - _VALUE.get(capturing, 0) >= 2


def _non_pawn_pieces(board: chess.Board) -> int:
    return sum(1 for p in board.piece_map().values() if p.piece_type not in (chess.PAWN, chess.KING))


def tag_move(board_before: chess.Board, played: chess.Move, best: chess.Move | None,
             cpl: int, clock_cs: int | None, best_pv: str | None = None) -> list[str]:
    if cpl < TAG_MIN_CPL:
        return []
    tags = []
    if _hanging_after(board_before, played):
        tags.append("hanging_piece")
    if best is not None and cpl >= 200 and _forcing(board_before, best) and not _forcing(board_before, played):
        tags.append("missed_tactic")
    if board_before.fullmove_number <= 10:
        tags.append("opening_error")
    if _non_pawn_pieces(board_before) <= 4:
        tags.append("endgame_technique")
    if clock_cs is not None and clock_cs < 3000:
        tags.append("time_trouble")
    if best is not None and best_is_quiet(board_before, best, best_pv) and not {"hanging_piece", "missed_tactic"} & set(tags):
        tags.append("positional")
    return tags or ["other"]
