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

# 제공자: OPENAI_API_KEY/LLM_BASE_URL 중 하나라도 있으면 OpenAI 호환 경로
# (진짜 OpenAI, 회사 내부 서빙 모델, Gemini 등 OpenAI 호환 엔드포인트 전부 포함).
# 둘 다 없으면 ANTHROPIC_API_KEY로 Anthropic(화면 조작만) 사용.
_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
_client = anthropic.Anthropic(api_key=_API_KEY) if _API_KEY else None

_OPENAI_KEY = os.environ.get("OPENAI_API_KEY")
_LLM_BASE_URL = os.environ.get("LLM_BASE_URL")
_openai = None
_store = None
if _OPENAI_KEY or _LLM_BASE_URL:
    from openai import OpenAI

    from llm_openai import call_openai
    from sqlstore import CardStore

    _openai = OpenAI(api_key=_OPENAI_KEY or "not-needed", base_url=_LLM_BASE_URL or None)
    _store = CardStore()
    logger.info(
        "OpenAI 호환 제공자 사용%s, card 테이블 %d행",
        f" (base_url={_LLM_BASE_URL})" if _LLM_BASE_URL else "",
        _store.rows,
    )

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
        "http://localhost:5175",
        "http://127.0.0.1:5175",
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
    queries: list[dict] = []   # 실행한 SQL (투명성 표시용)
    provider: str = ""


# ---------- 트렌드 온디맨드: 풀에 없는 키워드를 즉석에서 네이버에서 받아 판정 ----------
import json as _json
import subprocess
from fastapi import HTTPException

_ENGINE_ROOT = Path(os.environ.get("ENGINE_C_ROOT", str(Path(__file__).resolve().parents[2] / "engine_c")))
_ENGINE_PY = os.environ.get("ENGINE_C_PYTHON", str(_ENGINE_ROOT / ".venv" / "bin" / "python"))
_trend_cache: dict[str, dict] = {}


@app.get("/trend/{keyword}")
def trend_on_demand(keyword: str, industry: str | None = None):
    kw = keyword.strip()
    if not kw or len(kw) > 30:
        raise HTTPException(400, "키워드가 비었거나 너무 깁니다")
    if kw in _trend_cache:
        return _trend_cache[kw]
    if not (os.environ.get("NAVER_CLIENT_ID") and os.environ.get("NAVER_CLIENT_SECRET")):
        raise HTTPException(503, "네이버 API 키가 설정되지 않았습니다 (backend/.env NAVER_CLIENT_ID/SECRET)")
    try:
        r = subprocess.run([_ENGINE_PY, "-m", "trendlight.ondemand", kw, *( [industry] if industry else [])],
                           cwd=str(_ENGINE_ROOT), capture_output=True, text=True, timeout=180, env=os.environ.copy())
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "수집 시간 초과")
    if r.returncode != 0:
        logger.error("ondemand 실패 %s: %s", kw, r.stderr[-800:])
        raise HTTPException(502, "곡선을 받아오지 못했습니다 (네이버 한도 초과 또는 오류)")
    data = _json.loads(r.stdout.strip().splitlines()[-1])
    _trend_cache[kw] = data
    return data


@app.get("/health")
def health():
    return {
        "status": "ok",
        "configured": _client is not None or _openai is not None,
        "provider": "openai" if _openai else ("anthropic" if _client else None),
    }


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if _openai is not None:
        try:
            history = [m.model_dump() for m in req.history]
            reply, actions, queries = call_openai(_openai, _store, req.message, history, req.screen.model_dump())
            return ChatResponse(reply=reply, actions=actions, configured=True, queries=queries, provider="openai")
        except Exception:  # noqa: BLE001
            logger.exception("openai-compatible provider error")
            return ChatResponse(
                reply="답변을 만드는 중 오류가 발생했어요. 다시 시도해주세요.",
                actions=[],
                configured=True,
                provider="openai",
            )
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
