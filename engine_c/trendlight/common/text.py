"""키워드 문자열 정규화 (매칭용)."""
import re


def norm_kw(s: str) -> str:
    return re.sub(r"\s+", "", str(s)).lower()
