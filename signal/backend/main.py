import logging
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from llm_client import call_claude

load_dotenv(Path(__file__).parent / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("signal.chat")

_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
_client = anthropic.Anthropic(api_key=_API_KEY) if _API_KEY else None

app = FastAPI(title="signal-chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ScreenState(BaseModel):
    view: str
    industry: str
    industryLabel: str
    province: str
    metric: str
    selectedRegionId: str
    region: dict | None = None
    catalog: dict


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []
    screen: ScreenState


class ChatResponse(BaseModel):
    reply: str
    actions: list[dict]
    configured: bool


@app.get("/health")
def health():
    return {"status": "ok", "configured": _client is not None}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if _client is None:
        return ChatResponse(
            reply="채팅 기능이 아직 설정되지 않았어요. backend/.env에 ANTHROPIC_API_KEY를 추가하면 사용할 수 있어요.",
            actions=[],
            configured=False,
        )
    try:
        history = [m.model_dump() for m in req.history]
        reply, actions = call_claude(
            _client, req.message, history, req.screen.model_dump()
        )
        return ChatResponse(reply=reply, actions=actions, configured=True)
    except anthropic.AuthenticationError:
        logger.exception("auth error")
        return ChatResponse(
            reply="API 키가 유효하지 않아요. 관리자에게 문의해주세요.",
            actions=[],
            configured=False,
        )
    except anthropic.RateLimitError:
        logger.exception("rate limited")
        return ChatResponse(
            reply="지금 요청이 많아 잠시 후 다시 시도해주세요.",
            actions=[],
            configured=True,
        )
    except anthropic.APIConnectionError:
        logger.exception("connection error")
        return ChatResponse(
            reply="AI 서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요.",
            actions=[],
            configured=True,
        )
    except anthropic.APIStatusError:
        logger.exception("api error")
        return ChatResponse(
            reply="답변을 만드는 중 오류가 발생했어요. 다시 시도해주세요.",
            actions=[],
            configured=True,
        )
