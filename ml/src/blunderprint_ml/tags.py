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


def wins_free_material(board: chess.Board, move: chess.Move) -> bool:
    """Mate in one, or a capture of an undefended piece / a clearly favourable trade (gain >= 2)."""
    b = board.copy()
    capturing = b.piece_type_at(move.from_square)
    if board.is_en_passant(move):
        captured = chess.PAWN
    else:
        captured = b.piece_type_at(move.to_square)
    mover = b.turn
    b.push(move)
    if b.is_checkmate():
        return True
    if captured is None:
        return False
    if not b.attackers(not mover, move.to_square):
        return True
    return _VALUE.get(captured, 0) - _VALUE.get(capturing, 0) >= 2


def _non_pawn_pieces(board: chess.Board) -> int:
    return sum(1 for p in board.piece_map().values() if p.piece_type not in (chess.PAWN, chess.KING))


def tag_move(board_before: chess.Board, played: chess.Move, best: chess.Move | None,
             cpl: int, clock_cs: int | None) -> list[str]:
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
    if best is not None and is_quiet(board_before, best) and not {"hanging_piece", "missed_tactic"} & set(tags):
        tags.append("positional")
    return tags or ["other"]
