"""OpenAI 호환(Chat Completions) 기반 도우미: 화면 조작 도구 + 카드 데이터 SQL 질의 도구.

- 자연어 → SQL → 실행 결과를 근거로 답한다 (숫자는 결과에서만).
- 범위 밖 질문(예측·추천·창업 성패 판단·원인 분석·데이터 밖 지식·개인정보)은 정해진 문구로 거절한다.
- base_url을 바꾸면 회사 내부 서빙 모델·Gemini(OpenAI 호환 API) 등 어떤 OpenAI 호환 엔드포인트에도 그대로 붙는다.
"""
from __future__ import annotations

import json
import logging
import os

from openai import OpenAI

from llm_client import TOOLS as UI_TOOLS, build_system_prompt
from sqlstore import SCHEMA_TEXT, CardStore

log = logging.getLogger("signal.chat.openai")
MODEL = os.environ.get("LLM_MODEL", "gpt-5-mini")
MAX_TOOL_ROUNDS = 4

REFUSAL = "이 도우미는 BC카드 결제 데이터(2026년 1~6월의 지역·업종·성별·연령별 금액·건수)에 대한 조회와 비교만 답할 수 있어요. 예측·추천·원인 분석이나 데이터 밖 질문은 다루지 않아요. 예: \"성북구와 성동구 중 편의점 여성 결제 비율이 높은 곳은?\""

SCOPE_RULE = f"""
# 답변 범위 (엄격)
가능: card 테이블로 계산되는 조회·집계·비교·순위 (지역/업종/성별/연령/월별 금액·건수·비율·증감).
  - "증감/추세"는 **이미 조회된(과거) 월별 수치들끼리의 비교**를 말합니다. 예: "1월보다 6월이 늘었나?",
    "상승/하락 추세인가?", "꾸준히 줄고 있나?" — 이런 질문은 방금 조회한 숫자나 새 SQL 결과의 월별 값을
    비교해서 그대로 답하세요. 미래 예측이 아닙니다.
불가: **미래(다음 달/내년 등 아직 오지 않은 기간)에 대한 예측**, 창업 추천이나 성공/실패 판단, 원인·이유 해석,
  데이터에 없는 정보(임대료·유동인구·경쟁 등), 개인 식별, 데이터와 무관한 잡담.
불가한 질문이면 도구를 호출하지 말고 정확히 이 문장으로만 답하세요: "{REFUSAL}"
복합 질문 중 일부만 가능하면 가능한 부분만 답하고 나머지는 위 문장으로 거절하세요.

# SQL 규칙
- 반드시 query_card_data 도구로 SQL을 실행한 뒤, 결과 숫자만 인용해 답하세요. 결과에 없는 숫자는 절대 만들지 마세요.
- SELECT 하나만. 지역명은 LIKE 로 유연하게 매칭 (예: sigungu LIKE '%성북구%', sido LIKE '서울%').
- "인구 1인당"/"주민 1인당" 질문은 인구 데이터가 없어 계산할 수 없습니다. 도구를 호출하지 말고
  "인구 데이터가 없어 1인당 계산은 지원하지 않아요. 총 결제금액이나 업체당 평균매출로는 답해드릴 수 있어요."
  라고 답하세요(그 지역 결제액에는 외부에서 방문해 소비한 금액도 섞여 있어, 거주 인구만으로 나누면 오해를 줄 수 있기 때문입니다).
- 비율 질문은 분모에서 미상('x')·외국인('3')을 제외하고 계산하세요.
- 업종명은 공백 없이 (편의점, 슈퍼마켓, 제과점). 사용자가 업종을 말하지 않으면 전체 업종 합계로 계산하고 그렇게 답했다고 밝히세요.
- 결과가 비어 있으면 "자료 없음"이라고 답하세요.
- 답은 한국어로 짧게, 수치는 단위(원·건·%)와 함께. 금액은 억/만 단위로 읽기 쉽게.

# 스키마
{SCHEMA_TEXT}
"""


def _to_openai_tool(t: dict) -> dict:
    return {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}}


TOOLS = [_to_openai_tool(t) for t in UI_TOOLS] + [{
    "type": "function",
    "function": {
        "name": "query_card_data",
        "description": "BC카드 결제 집계 테이블 card 에 읽기 전용 SQL(SELECT 하나)을 실행하고 결과 행을 돌려줍니다.",
        "parameters": {"type": "object",
                       "properties": {"sql": {"type": "string", "description": "DuckDB SQL. SELECT 문 하나."},
                                      "purpose": {"type": "string", "description": "이 질의로 무엇을 계산하는지 한 문장"}},
                       "required": ["sql"], "additionalProperties": False},
    },
}]


def call_openai(client: OpenAI, store: CardStore, message: str, history: list[dict], screen: dict):
    system = build_system_prompt(screen) + "\n" + SCOPE_RULE
    messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": message}]
    actions, queries = [], []
    for _ in range(MAX_TOOL_ROUNDS):
        resp = client.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS, tool_choice="auto")
        msg = resp.choices[0].message
        if not msg.tool_calls:
            reply = (msg.content or "").strip().strip('"').strip("“”")
            return reply or REFUSAL, actions, queries
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
        for tc in msg.tool_calls:
            name, args = tc.function.name, {}
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                pass
            if name == "query_card_data":
                try:
                    res = store.query(args.get("sql", ""))
                    queries.append({
                        "sql": res["sql"],
                        "purpose": args.get("purpose", ""),
                        "columns": res["columns"],
                        "rows": res["rows"][:30],
                    })
                    payload = json.dumps({"columns": res["columns"], "rows": res["rows"][:60], "truncated": res["truncated"]}, ensure_ascii=False, default=str)
                except Exception as e:  # noqa: BLE001
                    payload = json.dumps({"error": str(e)}, ensure_ascii=False)
                    queries.append({"sql": args.get("sql", ""), "purpose": args.get("purpose", ""), "error": str(e)})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": payload})
            else:
                actions.append({"type": name, **args})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps({"ok": True}, ensure_ascii=False)})
    return "질의가 너무 복잡해 답을 만들지 못했어요. 질문을 더 단순하게 나눠 주세요.", actions, queries
