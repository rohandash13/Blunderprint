import os
from contextlib import asynccontextmanager

import chess
from fastapi import FastAPI
from pydantic import BaseModel

from .inference import p_played
from .models import load_checkpoint
from .tags import tag_move


class MoveIn(BaseModel):
    id: int
    fen: str
    rating: int | None = None
    played_uci: str
    best_uci: str | None = None
    cpl: int | None = None
    clock_cs: int | None = None


class AnalyzeRequest(BaseModel):
    moves: list[MoveIn]


class MoveOut(BaseModel):
    id: int
    p_played: float
    tags: list[str]


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
        out = []
        for m in req.moves:
            board = chess.Board(m.fen)
            played = chess.Move.from_uci(m.played_uci)
            best = chess.Move.from_uci(m.best_uci) if m.best_uci else None
            # Without a centipawn loss there is nothing to tag against, so no tags.
            tags = [] if m.cpl is None else tag_move(board, played, best, m.cpl, m.clock_cs)
            out.append(MoveOut(
                id=m.id,
                p_played=p_played(state["model"], m.fen, m.rating, m.played_uci),
                tags=tags,
            ))
        return out

    return app


app = create_app()
