import chess
import numpy as np
import torch

from .encoding import encode_board, legal_mask, move_index, rating_bucket


@torch.no_grad()
def _legal_probs(model, boards: list[chess.Board], ratings: list[int | None]) -> np.ndarray:
    """Masked softmax over legal move indices for each board: one forward pass, shape (N, num_moves)."""
    x = torch.from_numpy(np.stack([encode_board(b) for b in boards]))
    rb = torch.tensor([rating_bucket(r) for r in ratings])
    mask = torch.from_numpy(np.stack([legal_mask(b) for b in boards]))
    logits = model(x, rb)
    return torch.softmax(logits.masked_fill(~mask, float("-inf")), dim=1).numpy()


def p_played_batch(model, boards: list[chess.Board], moves: list[chess.Move],
                   ratings: list[int | None]) -> list[float]:
    if not boards:
        return []
    probs = _legal_probs(model, boards, ratings)
    return [float(probs[i, move_index(m, b.turn == chess.BLACK)])
            for i, (b, m) in enumerate(zip(boards, moves))]


def legal_distribution(model, fen: str, rating: int | None) -> dict[chess.Move, float]:
    board = chess.Board(fen)
    probs = _legal_probs(model, [board], [rating])[0]
    black = board.turn == chess.BLACK
    return {m: float(probs[move_index(m, black)]) for m in board.legal_moves}


def p_played(model, fen: str, rating: int | None, played_uci: str) -> float:
    board = chess.Board(fen)
    return p_played_batch(model, [board], [chess.Move.from_uci(played_uci)], [rating])[0]
