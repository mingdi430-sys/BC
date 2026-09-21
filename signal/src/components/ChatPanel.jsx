import React, { useMemo, useState } from "react";
import { Send } from "lucide-react";
import {
  industries,
  provinces,
  regionCatalog,
  industryLabel,
  metrics,
  resolveRegion,
} from "../data";

const API_BASE = import.meta.env.VITE_CHAT_API || "http://localhost:8000";

const GENDER_COLOR = { 남성: "#2554C7", 여성: "#E8398F" };
const BAR_COLOR = "#2554C7";

// LLM 답변의 **굵게** 마크다운만 최소로 렌더링한다 (전체 마크다운 파서는 안 씀).
function renderMarkdown(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

// SQL 결과가 "라벨 여러 개 + 마지막 열 숫자" 모양이면 막대그래프로 그릴 수 있다고 판단한다.
function chartData(query) {
  const { columns, rows } = query;
  if (!columns || !rows || rows.length < 2 || rows.length > 12) return null;
  const valueIdx = columns.length - 1;
  if (!rows.every((r) => typeof r[valueIdx] === "number")) return null;
  const bars = rows.map((r) => ({
    label: r.slice(0, valueIdx).filter((v) => v != null && v !== "").join(" ") || "(전체)",
    value: r[valueIdx],
  }));
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  return { bars, max };
}

function QueryChart({ query }) {
  const chart = chartData(query);
  if (!chart) return null;
  return (
    <div className="chat-chart">
      {chart.bars.map((b, i) => (
        <div className="chat-chart-row" key={i}>
          <span className="chat-chart-label">{b.label}</span>
          <div className="chat-chart-track">
            <div
              className="chat-chart-fill"
              style={{
                width: `${(Math.abs(b.value) / chart.max) * 100}%`,
                background: GENDER_COLOR[b.label] || BAR_COLOR,
              }}
            />
          </div>
          <span className="chat-chart-value">{b.value.toLocaleString("ko-KR")}</span>
        </div>
      ))}
    </div>
  );
}

export function ChatPanel({
  industry,
  setIndustry,
  selected,
  setSelected,
  province,
  metric,
  setMetric,
  all,
  region,
  view,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);

  const screen = useMemo(
    () => ({
      view,
      industry,
      industryLabel: industryLabel(industry),
      province,
      metric,
      selectedRegionId: selected,
      region: region
        ? {
            id: region.id,
            province: region.province,
            name: region.name,
            isAggregate: !!region.isAggregate,
            hasData: region.hasData,
            amount: region.amount,
            count: region.count,
            growth: region.growth,
            periodGrowth: region.periodGrowth,
            stores: region.stores,
            amountPerStore: region.amountPerStore,
            nationalRank: region.nationalRank,
            nationalTotal: region.nationalTotal,
            lowSample: region.lowSample,
          }
        : null,
      catalog: { industries, provinces, regions: regionCatalog },
    }),
    [view, industry, province, metric, selected, region],
  );

  function applyActions(actions) {
    for (const action of actions || []) {
      switch (action.type) {
        case "set_industry":
          if (industries.includes(action.industry)) setIndustry(action.industry);
          break;
        case "show_region": {
          if (action.region_id === "") {
            setSelected("");
            break;
          }
          const target = resolveRegion(all, action.region_id);
          if (target) setSelected(target.id); // 존재하지 않는 id는 조용히 무시
          break;
        }
        case "set_metric":
          if (action.metric in metrics) setMetric(action.metric);
          break;
        case "clear_selection":
          setSelected("");
          break;
        default:
          break;
      }
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: next.slice(-13, -1).map((m) => ({ role: m.role, content: m.content })),
          screen,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      applyActions(data.actions);
      setConfigured(data.configured);
      setMessages((m) => [...m, { role: "assistant", content: data.reply, queries: data.queries || [] }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "채팅 서버에 연결할 수 없어요. 백엔드가 실행 중인지 확인해주세요." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <strong>MarketSignal 도우미</strong>
        {!configured && <span className="chat-badge">설정 준비중</span>}
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-empty">
            카드 데이터에 대해 물어보세요. 예: "성북구와 성동구 중 여성 결제 비율이 높은 곳은?", "서울에서 20대 비중이 높은 구 3개",
            "강릉시 갈비전문점 보여줘". 예측·추천·원인 분석은 답하지 않아요.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {renderMarkdown(m.content)}
            {m.queries?.filter((q) => !q.error).map((q, j) => <QueryChart key={j} query={q} />)}
            {m.queries?.length > 0 && (
              <details className="chat-sql">
                <summary>근거 SQL {m.queries.length}건</summary>
                {m.queries.map((q, j) => (
                  <div key={j}>
                    {q.purpose && <small>{q.purpose}</small>}
                    <pre>{q.sql}</pre>
                    <small>{q.error ? `오류: ${q.error}` : `${q.rows.length}행`}</small>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
        {loading && <div className="chat-bubble assistant chat-loading">…</div>}
      </div>
      <form className="chat-input" onSubmit={sendMessage}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지를 입력하세요"
          aria-label="채팅 입력"
        />
        <button type="submit" className="icon-button" aria-label="전송" disabled={loading}>
          <Send size={16} />
        </button>
      </form>
    </aside>
  );
}
