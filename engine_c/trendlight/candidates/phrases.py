"""제목·설명에서 명사구 추출 (kiwipiepy)."""
from __future__ import annotations

import html
import re
from functools import lru_cache

from ..config import industries as industries_cfg, label_keywords

_NOUN_TAGS = {"NNG", "NNP", "SL"}  # 일반명사, 고유명사, 외래어(알파벳)
_MAX_PHRASE_TOKENS = 3


@lru_cache(maxsize=1)
def _kiwi():
    from kiwipiepy import Kiwi
    return Kiwi(num_workers=1)


@lru_cache(maxsize=1)
def stopwords() -> frozenset:
    """업종 쿼리 단어 자체와 흔한 잡음. 라벨 키워드는 여기 넣지 않는다(후보 생성에 라벨 개입 금지)."""
    base = {"신상", "추천", "리뷰", "먹방", "유행", "맛집", "요즘", "신메뉴", "신제품", "꿀템", "꿀조합",
            "영상", "채널", "구독", "좋아요", "알림", "설정", "링크", "문의", "이메일", "협찬", "광고",
            "오늘", "내일", "진짜", "완전", "역대급", "레전드", "브이로그", "일상", "쇼츠", "shorts",
            "편", "년", "월", "일", "개", "번", "것", "수", "때", "중", "등", "및", "시", "분",
            # 일반어·채널 잡음 (실측 상위 빈도에서 추가)
            "조합", "할인", "이번", "정보", "제품", "인기", "한국", "레시피", "여행", "일본", "중국", "미국",
            "소개", "방법", "이유", "가격", "후기", "비교", "정리", "모음", "공개", "출시", "현장", "사장", "손님",
            "asmr", "ai", "official", "channel", "chan", "nel", "flv", "vlog", "tv", "gs", "cu", "shorts",
            "mukbang", "top", "ep", "quot", "amp", "브이", "로그", "소통", "토크", "구독", "역대", "난리", "필수", "정리",
            # 일반명사·뉴스·상황 어휘 (아이템이 아님)
            "직전", "조사", "검찰", "경찰", "논란", "사건", "사고", "정부", "대통령", "국회", "완벽", "공장", "상가", "골목", "순식간",
            "선물", "고객", "오픈", "점포", "전통", "정상영업", "영업", "매장", "사장님", "직원", "알바", "가게", "식당", "손님",
            "가격", "가성비", "할인", "세일", "품절", "대란", "리뷰", "후기", "추천", "비교", "정보", "이유", "방법", "레시피",
            "요리", "음식", "메뉴", "간식", "디저트", "과자", "빵", "고기", "한국", "국내", "전국", "동네", "근처", "주말", "명절", "추석", "설날",
            "여름", "겨울", "봄", "가을", "아침", "점심", "저녁", "야식", "혼밥", "회식", "데이트", "가족", "부모", "아이", "학생", "직장인"}
    icfg = industries_cfg()
    for ind in icfg["industries"].values():
        for q in ind["queries"]:
            base.update(q.split())
    return frozenset(base)

# 지명 (시도·주요 도시·서울 구) — 급등해도 아이템이 아니다
REGION_WORDS = frozenset("""서울 부산 대구 인천 광주 대전 울산 세종 경기 강원 충북 충남 전북 전남 경북 경남 제주 수원 성남 고양 용인 창원 청주 천안 전주 포항 김해
안산 안양 남양주 화성 평택 의정부 시흥 파주 김포 광명 군포 여수 순천 목포 경주 구미 강릉 원주 춘천 속초 홍대 강남 이태원 성수 명동 종로 신촌 잠실 건대
을지로 압구정 연남 망원 익선동 해운대 광안리 서면 동성로 전포 부천 일산 분당 판교 송도 대학로 노량진 마포 용산 영등포 강서 송파 중구 동구 서구 남구 북구""".split())


# 국내 수요 신호가 아닌 영상(해외 여행·해외 편의점 등)은 명사구 집계에서 제외
FOREIGN_MARKERS = re.compile(r"일본|해외|미국|중국 여행|여행|외국인|오사카|후쿠오카|도쿄|방콕|다낭|마카오|필리핀|베트남|캄보디아|카지노|강원랜드")


def is_domestic(text: str) -> bool:
    return not FOREIGN_MARKERS.search(text or "")


def extract_phrases(text: str) -> list[str]:
    """연속된 명사 토큰을 1~3개 묶어 명사구로 반환 (중복 제거, 등장 순)."""
    if not text:
        return []
    text = html.unescape(text)  # YouTube 제목의 &quot; &amp; &#39; 등
    text = re.sub(r"https?://\S+|#\S+|@\S+", " ", text)
    toks = _kiwi().tokenize(text)
    out, run = [], []
    sw = stopwords()

    def flush():
        if not run:
            return
        n = len(run)
        for i in range(n):
            for j in range(i + 1, min(n, i + _MAX_PHRASE_TOKENS) + 1):
                ph = "".join(run[i:j]) if all(re.match(r"^[가-힣]+$", t) for t in run[i:j]) else " ".join(run[i:j])
                if len(ph) < 2 or ph.lower() in sw or ph.isdigit():
                    continue
                if not re.search(r"[가-힣]", ph):                     # 한글 없는 명사구(영문 조각·채널명) 제외
                    continue
                if any(tok in REGION_WORDS for tok in run[i:j]) or ph in REGION_WORDS:
                    continue
                if re.search(r"[^\w\s]", ph):                      # 구두점 섞인 채널명 조각 제외
                    continue
                out.append(ph)
        run.clear()

    for t in toks:
        if t.tag in _NOUN_TAGS and len(t.form) >= 1 and t.form.lower() not in sw:
            run.append(t.form)
        else:
            flush()
    flush()
    seen, uniq = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq
