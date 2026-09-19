"""Anthropic Claude client wrapper for the 신호등 chat assistant.

Grounding rule mirrors src/data.js's money()/signed(): never invent a number.
Missing data is reported honestly as "자료 없음" / "비교 불가" — the same Korean
phrases already used in the frontend UI.
"""

import json

import anthropic

MODEL = "claude-opus-5"

TOOLS = [
    {
        "name": "set_industry",
        "description": (
            "사용자가 분석할 업종을 변경합니다. 지역 선택은 자동으로 초기화됩니다. "
            "industry 값은 제공된 catalog.industries 목록의 문자열과 정확히 일치해야 "
            "하며, 일부 업종명에 포함된 내부 공백(예: '슈퍼 마켓', '제 과 점', "
            "'편 의 점')도 그대로 유지해야 합니다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"industry": {"type": "string"}},
            "required": ["industry"],
            "additionalProperties": False,
        },
    },
    {
        "name": "show_region",
        "description": (
            "지도를 특정 지역으로 이동하고 지역 상세 패널을 표시합니다. region_id는 "
            "반드시 catalog.regions 배열의 id 값 중 하나를 그대로 사용하세요. "
            "leaf 지역은 '시도명|지역명'(예: '강원특별자치도|강릉시') 형식이고, "
            "시 전체 합계는 'city:시도명|시명'(예: 'city:경기도|성남시') 형식입니다. "
            "선택을 해제하려면 빈 문자열을 사용하세요."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"region_id": {"type": "string"}},
            "required": ["region_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "set_metric",
        "description": "지도의 표시 기준(색상 지표)을 변경합니다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "metric": {
                    "type": "string",
                    "enum": [
                        "amount",
                        "count",
                        "growth",
                        "perCompetitorAmount",
                    ],
                }
            },
            "required": ["metric"],
            "additionalProperties": False,
        },
    },
    {
        "name": "clear_selection",
        "description": "선택된 지역을 해제하고 시도 전체 개요로 돌아갑니다.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
]

GROUNDING_RULE = (
    "당신은 '신호등'(BC카드 상권 분석 서비스)의 한국어 분석 도우미입니다. "
    "제공된 screen 컨텍스트의 수치만 사용하고, 절대로 숫자를 추측하거나 "
    "지어내지 마세요. 값이 null이거나 없으면 반드시 '자료 없음' 또는 "
    "'비교 불가'라고 정직하게 답하세요(화면 UI와 동일한 표현). "
    "화면을 조작해야 할 때는 반드시 제공된 도구를 호출하고, 도구를 호출할 "
    "때도 무엇을 했는지 한두 문장으로 자연어 설명을 함께 답하세요."
)


def build_system_prompt(screen: dict) -> str:
    catalog = screen.get("catalog", {})
    static_block = json.dumps(
        {
            "industries": catalog.get("industries", []),
            "provinces": catalog.get("provinces", []),
            "regions": catalog.get("regions", []),
        },
        ensure_ascii=False,
    )
    live_block = json.dumps(
        {k: v for k, v in screen.items() if k != "catalog"}, ensure_ascii=False
    )
    return (
        f"{GROUNDING_RULE}\n\n"
        f"# 참조 카탈로그 (업종/시도/지역 id 목록)\n{static_block}\n\n"
        f"# 현재 화면 상태\n{live_block}"
    )


def synthesize_reply(actions: list[dict]) -> str:
    """Claude가 텍스트 블록 없이 tool_use만 반환한 경우의 대체 문구."""
    parts = []
    for a in actions:
        if a["type"] == "set_industry":
            parts.append(f"{a['industry']} 업종으로 변경했어요.")
        elif a["type"] == "show_region":
            parts.append(
                "선택을 해제했어요." if a["region_id"] == "" else "해당 지역을 화면에 표시했어요."
            )
        elif a["type"] == "set_metric":
            parts.append("표시 기준을 변경했어요.")
        elif a["type"] == "clear_selection":
            parts.append("선택을 초기화했어요.")
    return " ".join(parts) or "요청하신 내용을 반영했어요."


def call_claude(
    client: anthropic.Anthropic, message: str, history: list[dict], screen: dict
):
    messages = [*history, {"role": "user", "content": message}]
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=build_system_prompt(screen),
        tools=TOOLS,
        messages=messages,
    )

    text_parts, actions = [], []
    for block in response.content:
        if block.type == "text":
            text_parts.append(block.text)
        elif block.type == "tool_use":
            actions.append({"type": block.name, **block.input})

    reply = "\n".join(t for t in text_parts if t.strip()) or synthesize_reply(actions)
    return reply, actions
