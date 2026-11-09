import chess
import numpy as np
import torch

from .encoding import encode_board, legal_mask, move_index, rating_bucket


@torch.no_grad()
def legal_distribution(model, fen: str, rating: int | None) -> dict[chess.Move, float]:
    board = chess.Board(fen)
    x = torch.from_numpy(encode_board(board)).unsqueeze(0)
    rb = torch.tensor([rating_bucket(rating)])
    logits = model(x, rb)[0]
    mask = torch.from_numpy(legal_mask(board))
    probs = torch.softmax(logits.masked_fill(~mask, float("-inf")), dim=0).numpy()
    black = board.turn == chess.BLACK
    return {m: float(probs[move_index(m, black)]) for m in board.legal_moves}


def p_played(model, fen: str, rating: int | None, played_uci: str) -> float:
    board = chess.Board(fen)
    played = chess.Move.from_uci(played_uci)
    black = board.turn == chess.BLACK
    x = torch.from_numpy(encode_board(board)).unsqueeze(0)
    with torch.no_grad():
        logits = model(x, torch.tensor([rating_bucket(rating)]))[0]
        mask = torch.from_numpy(legal_mask(board))
        probs = torch.softmax(logits.masked_fill(~mask, float("-inf")), dim=0).numpy()
    return float(probs[move_index(played, black)])
