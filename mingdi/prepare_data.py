"""
BC카드 소비데이터 -> 대시보드용 data.json 생성
지역(시도+시군구) x 업종별로 화면에 필요한 지표 전부 계산
"""
import pandas as pd
import numpy as np
import json

df = pd.read_csv('/mnt/user-data/uploads/ABP_CONTEST_DATA.csv')
df['CCG_FULL'] = df['SIDO_NM'] + ' ' + df['CCG_NM']
biz_cols = ['갈비전문점','대형할인점','서양음식','슈퍼 마켓','스넥','일반한식','일식회집','제 과 점','중국음식','편 의 점','한정식']

months = sorted(df['STRD_YYMM'].unique())

# 지역x업종x월 매출/건수
g = df.groupby(['CCG_FULL','TP_BUZ_NM','STRD_YYMM']).agg(amt=('amt','sum'), cnt=('cnt','sum')).reset_index()

regions = sorted(df['CCG_FULL'].unique())
output = {}

for region in regions:
    sido, gu = region.split(' ', 1)
    output.setdefault(sido, {})
    biz_data = {}
    for biz in biz_cols:
        sub = g[(g['CCG_FULL']==region) & (g['TP_BUZ_NM']==biz)]
        if len(sub) == 0:
            biz_data[biz] = None
            continue
        amt_by_month = sub.set_index('STRD_YYMM')['amt'].reindex(months, fill_value=0)
        cnt_by_month = sub.set_index('STRD_YYMM')['cnt'].reindex(months, fill_value=0)
        total_amt = int(amt_by_month.sum())
        total_cnt = int(cnt_by_month.sum())
        avg_price = round(total_amt/total_cnt) if total_cnt>0 else 0
        monthly = [int(v) for v in amt_by_month.tolist()]

        # 전국 업종 순위 (이 업종 매출 기준, 전체 지역 대비)
        nat_rank_series = g[g['TP_BUZ_NM']==biz].groupby('CCG_FULL')['amt'].sum().sort_values(ascending=False)
        nat_total = len(nat_rank_series)
        rank = int(nat_rank_series.index.get_loc(region)) + 1 if region in nat_rank_series.index else None

        # 기간내 첫달->마지막달 증감률 (0이면 계산 불가)
        first, last = monthly[0], monthly[-1]
        growth = round((last-first)/first*100, 1) if first > 0 else None

        n_months_with_data = sum(1 for v in monthly if v>0)

        biz_data[biz] = {
            'amt6': total_amt, 'cnt6': total_cnt, 'avgPrice': avg_price,
            'natRank': rank, 'natTotal': nat_total,
            'monthly': monthly, 'growth': growth,
            'lowSample': n_months_with_data <= 2
        }
    output[sido][gu] = biz_data

with open('data/region_biz.json', 'w', encoding='utf-8') as f:
    json.dump({'months': [str(m) for m in months], 'data': output}, f, ensure_ascii=False, separators=(',',':'))

import os
print('완료. 크기:', round(os.path.getsize('data/region_biz.json')/1024/1024,2), 'MB')
print('시도 수:', len(output))
