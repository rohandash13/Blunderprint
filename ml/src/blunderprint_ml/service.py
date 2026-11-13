import os
from contextlib import asynccontextmanager

import chess
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .inference import p_played_and_best_batch
from .models import load_checkpoint
from .tags import best_is_quiet, tag_move, wins_free_material


class MoveIn(BaseModel):
    id: int
    fen: str
    rating: int | None = None
    played_uci: str
    best_uci: str | None = None
    best_pv: str | None = None
    cpl: int | None = None
    clock_cs: int | None = None


class AnalyzeRequest(BaseModel):
    moves: list[MoveIn]


class MoveOut(BaseModel):
    id: int
    p_played: float
    p_best: float | None = None
    tags: list[str]
    best_quiet: bool | None = None
    best_free_material: bool | None = None


def _invalid(move_id: int, reason: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"id": move_id, "reason": reason})


def create_app() -> FastAPI:
    state = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state["model"] = load_checkpoint(os.environ.get("MODEL_CKPT", "checkpoints/mlp.pt"))
        yield

    app = FastAPI(lifespan=lifespan)

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/analyze", response_model=list[MoveOut])
    def analyze(req: AnalyzeRequest):
        boards, playeds, bests = [], [], []
        for m in req.moves:
            try:
                board = chess.Board(m.fen)
            except ValueError as e:
                raise _invalid(m.id, f"invalid FEN: {e}")
            try:
                played = chess.Move.from_uci(m.played_uci)
            except ValueError as e:
                raise _invalid(m.id, f"invalid played_uci: {e}")
            if played not in board.legal_moves:
                raise _invalid(m.id, f"illegal played_uci {m.played_uci} in position")
            best = None
            if m.best_uci is not None:
                try:
                    best = chess.Move.from_uci(m.best_uci)
                except ValueError as e:
                    raise _invalid(m.id, f"invalid best_uci: {e}")
                if best not in board.legal_moves:
                    raise _invalid(m.id, f"illegal best_uci {m.best_uci} in position")
            boards.append(board)
            playeds.append(played)
            bests.append(best)

        scored = p_played_and_best_batch(state["model"], boards, playeds, bests, [m.rating for m in req.moves])
        out = []
        for m, board, played, best, (p, pb) in zip(req.moves, boards, playeds, bests, scored):
            # Without a centipawn loss there is nothing to tag against, so no tags.
            tags = [] if m.cpl is None else tag_move(board, played, best, m.cpl, m.clock_cs, m.best_pv)
            out.append(MoveOut(
                id=m.id, p_played=p, p_best=pb, tags=tags,
                best_quiet=None if best is None else best_is_quiet(board, best, m.best_pv),
                best_free_material=None if best is None else wins_free_material(board, best)))
        return out

    return app


app = create_app()
