import fs from 'node:fs';
import assert from 'node:assert/strict';
const raw=JSON.parse(fs.readFileSync(new URL('../src/cardData.json',import.meta.url),'utf8'));
const code=fs.readFileSync(new URL('../src/data.js',import.meta.url),'utf8').replace(/^\uFEFF?(import .*;\s*)+/,'').replace(/export /g,'');
const api=new Function('source','genderAgeSource','populationSource','businessDensitySource',code+'\nreturn {getRecords,municipalityGroups,resolveRegion};')(raw,{},{data:{}},{data:{}});
let total=0,count=0,cities=0;
for(const industry of raw.industries){const leaves=api.getRecords(industry),groups=api.municipalityGroups(leaves);const ids=groups.flatMap(g=>g.memberIds);assert.equal(new Set(ids).size,255);assert.equal(ids.length,255);for(const group of groups){total+=group.amount||0;count+=group.count||0;if(!group.isAggregate)continue;cities++;const members=raw.records.filter(r=>r.industry===industry&&group.memberIds.includes(r.id));assert.equal(group.amount,members.length?members.reduce((s,r)=>s+r.amount,0):null);assert.equal(group.count,members.length?members.reduce((s,r)=>s+r.count,0):null);const prev=members.reduce((s,r)=>s+(r.monthly['202605']?.amount||0),0),current=members.reduce((s,r)=>s+(r.monthly['202606']?.amount||0),0);if(prev&&members.some(r=>r.monthly['202606']))assert.equal(group.growth,(current/prev-1)*100);assert.equal(api.resolveRegion(leaves,group.id).id,group.id);}}
assert.equal(total,raw.meta.sourceAmount);assert.equal(count,raw.meta.sourceCount);console.log('PASS: 11 industries; every CSV leaf appears in exactly one municipality; total amount/count preserved; '+cities+' city aggregates checked including weighted monthly change.');

