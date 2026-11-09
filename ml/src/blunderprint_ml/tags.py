"""Rule-based, explainable mistake tags."""
import chess

MISTAKE_CPL = 100
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


def _non_pawn_pieces(board: chess.Board) -> int:
    return sum(1 for p in board.piece_map().values() if p.piece_type not in (chess.PAWN, chess.KING))


def tag_move(board_before: chess.Board, played: chess.Move, best: chess.Move | None,
             cpl: int, clock_cs: int | None) -> list[str]:
    if cpl < MISTAKE_CPL:
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
    return tags or ["other"]
