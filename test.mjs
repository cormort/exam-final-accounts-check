// 回歸測試：抽出 index.html 的模組腳本，在 Node 對 examples/ 下 110–114 五個年度的 PDF 跑同一份邏輯。
// 工具本身一次只看一本；跨年度規則只放在這裡，用來驗證解析沒取錯。
//   npm install && npm test
//   node test.mjs --dump   印出所有非「相符」項與出處
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const el = () => new Proxy({ addEventListener() {} }, { get: (t, k) => (k in t ? t[k] : undefined), set: () => true });
globalThis.document = { getElementById: el };

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const src = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/from 'https:\/\/cdnjs[^']*pdf\.min\.mjs'/, "from 'pdfjs-dist/legacy/build/pdf.mjs'")
    .replace(/^.*GlobalWorkerOptions.*$/m, '')
    .replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/', path.join(ROOT, 'node_modules/pdfjs-dist/cmaps/'))
    .concat('\nexport { parseFile, runChecks, evalRule, checkTree, amt, toNum, valuesByColumn, chineseAmt, rowSums, compareVersions, readPages, treesOf, govMore, fundMore, hasWords, pdfjsLib, CMAP };\n');
const bundle = path.join(ROOT, '.bundle.mjs');
fs.writeFileSync(bundle, src);
const api = await import(pathToFileURL(bundle));
fs.unlinkSync(bundle);

// 純函式
assert.equal(api.amt('1億4,983萬8,493'), 149838493);
assert.equal(api.amt('5,450萬'), 54500000);
assert.equal(api.toNum('- 2,658,110'), -2658110);
assert.equal(api.chineseAmt(149838493), '1億4,983萬8,493元');
assert.equal(api.chineseAmt(-54500000), '負 5,450萬元');
assert.equal(api.chineseAmt(0), '0元');
const rs0 = api.rowSums({ cols: ['甲', '乙'], rows: [{ n: [10, 1] }, { n: [3, 1] }, { n: [] }, { n: [7, 1] }] }, ri => [1, 2, 1, 3][ri]);
assert.deepEqual([rs0.count, rs0.detail, rs0.total, rs0.diff], [3, [7, 0], [7, 1], [0, -1]]);
assert.deepEqual(api.valuesByColumn({ cells: [{ r: 201, s: '-' }, { r: 358, s: '-' }, { r: 408, s: '92,529,794' }] }, [209, 347, 408]), [0, null, -92529794]);

const byYear = {}, trees = {}, more = [];
for (const f of fs.readdirSync(path.join(ROOT, 'examples')).filter(n => !n.includes('budget')).sort().reverse()) {   // 同年度公務表在前
    const r = await api.parseFile(new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples', f))));
    assert.ok(r, '無法辨識 ' + f);
    (byYear[r.year] ??= {})[r.book] = r.facts;
    (trees[r.year] ??= []).push(...r.trees);
    more.push(...r.more);
}
// 上年度欄＝前一本的本年度：同一數字由兩本 PDF 各取一次，對得上才算沒取錯
const Y = '跨年度（僅驗證用）';
const CROSS_YEAR = [
    ['基金淨值', ['F.平衡.淨值.上'], ['P:F.平衡.淨值.本']],
    ['基金資產', ['F.平衡.資產.上'], ['P:F.平衡.資產.本']],
    ['基金本期賸餘', ['F.收支.本期賸餘.上年'], ['P:F.收支.本期賸餘.決算']],
    ['基金業務收入', ['F.收支.業務收入.上年'], ['P:F.收支.業務收入.決算']],
    ['基金業務成本', ['F.收支.業務成本.上年'], ['P:F.收支.業務成本.決算']],
    ['公務資產', ['G.平衡.資產.上'], ['P:G.平衡.資產.本']],
    ['公務長期投資', ['G.平衡.長期投資.上'], ['P:G.平衡.長期投資.本']],
    ['公務投資損益', ['G.收支.投資收益.上', '-G.收支.投資損失.上'], ['P:G.收支.投資收益.本', '-P:G.收支.投資損失.本']],
].map(([name, left, right]) => ({ group: Y, name: name + '上年度＝前一本', left, right }));
function runAll() {
    return Object.keys(byYear).flatMap(y => {
        const prev = byYear[y - 1];
        const facts = { ...byYear[y].F, ...byYear[y].G };
        if (prev) for (const [k, v] of Object.entries({ ...prev.F, ...prev.G })) facts['P:' + k] = v;
        return [...api.runChecks(facts), ...(prev ? CROSS_YEAR.map(r => api.evalRule(r, facts)) : [])].map(r => ({ ...r, year: +y }));
    });
}
const rs = runAll();
const count = k => rs.filter(r => r.result === k).length;
if (process.argv.includes('--dump')) {
    for (const r of rs.filter(r => r.result !== '相符')) {
        const side = s => s.parts.map(p => `${p.term}=${p.v}`).join(' ');
        console.log(`${r.year} ${r.result} ${r.name} | ${side(r.left)} || ${side(r.right)} | diff ${r.diff}`);
    }
}
const summary = { total: rs.length, 相符: count('相符'), 不符: count('不符'), 無法驗: count('無法驗') };
console.log(summary);

// 基準：下列都是回原頁確認過、決算書本身的差異或缺表；解析或規則一動到就會失敗
const EXPECT_BAD = [
    '110 長期投資明細表首列成本＝考選業務基金列 -50',
    '110 長期投資明細表首列合計＝考選業務基金列 -50',
    '111 變動表評價變動數＝基金本期賸餘(短絀) -290564',
    '111 平衡表長期投資＝變動表期末 290564',
    '112 補捐助報告表已撥＝用途別對特種基金之補助 -75289000',
];
assert.deepEqual(rs.filter(r => r.result === '不符').map(r => `${r.year} ${r.name} ${r.diff}`), EXPECT_BAD);
assert.deepEqual(rs.filter(r => r.result === '無法驗').map(r => `${r.year} ${r.name}`), [
    '110 現金流量增加無形資產＝無形資產明細表決算', '111 現金流量增加無形資產＝無形資產明細表決算',   // 這兩年沒有此表
]);
assert.equal(summary.total, 5 * 149 + 4 * 8);   // 每年 149 條＋4 組相鄰年度各 8 條

// 兩本各自獨立：只放一本時不跑另一本與跨書規則
const F0 = byYear[114].F, G0 = byYear[114].G;
assert.ok(api.runChecks(F0).every(r => r.group.startsWith('基金')));
assert.ok(api.runChecks(G0).every(r => r.group.startsWith('公務')));
assert.equal(api.runChecks(F0).length + api.runChecks(G0).length + 12, 149);

// 表內散總：80 張表全部要讀得到且全部相符（114 年第 41 頁主管列印全 0 只提醒）
const tr = Object.entries(trees).flatMap(([y, ts]) => ts.flatMap(t => api.checkTree(t).map(r => ({ ...r, year: +y }))));
const tcount = k => tr.filter(r => r.result === k).length;
assert.equal(Object.values(trees).flat().length, 80);
// 111 年第 23 頁：減少 1,400 只印在機械及設備欄，合計欄空白；其他分析表、報告表五年都相符，超過門檻的也都有寫說明
assert.deepEqual(more.map(l => `${l.name} ${l.diff}`), ['資產折舊明細表合計欄：期末帳面＝上年度＋新增－減少±調整－提列 -1400']);
assert.equal(tcount('無法驗'), 0);
assert.deepEqual(tr.filter(r => r.result === '不符').map(r => `${r.year} ${r.name} ${r.diff}`), []);
assert.deepEqual(tr.filter(r => r.result === '提醒').map(r => `${r.year} ${r.name}`), ['114 以前年度歲出機關別轉入數決算表｜考試院主管：標題列印成 0，通常應留白，金額不受影響（PDF 第 41 頁）']);
// 否證：每格改動 1 元，不符數都要增加（防止某格根本沒被檢查）
let cellFlips = 0;
const unchecked = [];
for (const [y, ts] of Object.entries(trees)) for (const t of ts) {
    const base = api.checkTree(t).filter(r => r.result === '不符').length;
    for (const r of t.rows) r.n.forEach((v, i) => {
        r.n[i] = v + 1;
        const after = api.checkTree(t).filter(x => x.result === '不符').length;
        r.n[i] = v;
        if (after > base) cellFlips++; else unchecked.push(`${y} ${t.title} ${r.name} [${t.cols[i]}] 第 ${r.page} 頁`);
    });
}
console.log(`表內散總：${tcount('相符')} 張表全部相符；改動 1 元被抓到 ${cellFlips} 格`);
// 基金主要表的賸餘列、現金流量各列不在母子關係內，由跨表規則或該列公式檢查
assert.deepEqual(unchecked.filter(u => !/ (收支餘絀表|平衡表|現金流量表) /.test(u)), []);

// 否證：拿掉備註文字，「未說明」提醒都要出現
const load = async f => {
    const doc = await api.pdfjsLib.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples', f))), ...api.CMAP, verbosity: 0 }).promise;
    return api.readPages(doc);
};
const strip = (pages, title, keep = () => false) => { for (const p of pages) if (p.head.includes(title)) for (const r of p.rows) r.cells = r.cells.filter(c => !api.hasWords(c) || c.x < 200 || keep(c)); };
const reminds = async (f, book, titles, want) => {
    const pages = await load(f);
    for (const t of titles) strip(pages, t, c => /\d{10}-/.test(c.s));
    return (book === 'F' ? api.fundMore : api.govMore)(pages, api.treesOf(book, pages)).lines.filter(l => l.result === '提醒' && l.name.startsWith(want)).length;
};
assert.ok(await reminds('gov-113.pdf', 'G', ['分析表'], '人事費分析表') > 0);
assert.ok(await reminds('gov-114.pdf', 'G', ['歲入餘絀(或減免、註銷)分析表'], '歲入餘絀分析表') > 0);
assert.ok(await reminds('fund-111.pdf', 'F', ['主要營運項目執行績效摘要表'], '主要營運項目') > 0);
assert.ok(await reminds('fund-111.pdf', 'F', ['管制性項目及統計所需項目比較表'], '管制性項目') > 0);
assert.ok(await reminds('fund-110.pdf', 'F', ['業務外收入明細表'], '業務外收入明細表') > 0);

// 預算書
const budget = [];
for (const f of fs.readdirSync(path.join(ROOT, 'examples')).filter(n => n.includes('budget'))) {
    const r = await api.parseFile(new Uint8Array(fs.readFileSync(path.join(ROOT, 'examples', f))));
    assert.ok(r, '無法辨識 ' + f);
    budget.push({ f, ...r });
}
assert.equal(budget.length, 17);
// 版本比對：同一本對自己 0 差異，115 年公務案與法定要有差異
const book = n => budget.find(b => b.f.startsWith(n));
assert.equal(api.compareVersions(book('gov-budget-115-law'), book('gov-budget-115-law')).filter(x => x.result === '提醒').length, 0);
const versions = api.compareVersions(book('gov-budget-115-bill'), book('gov-budget-115-law')).filter(x => x.result === '提醒');
assert.ok(versions.length > 0);
console.log(`115 年公務預算案對法定預算：${versions.length} 格不同`);
// 公務對基金補助不超過基金補助收入
for (const y of [112, 113, 114, 115, 116]) {
    const r = api.runChecks({ ...book(`gov-budget-${y}-bill`).facts, ...book(`fund-budget-${y}-bill`).facts }).find(x => x.group.startsWith('公務↔基金預算'));
    assert.equal(r.result, '相符');
}
{
    let ok = 0, moved = 0, ruleFlips = 0;
    const missed = [];
    for (const b of budget) {
        const all = [...api.runChecks(b.facts), ...b.trees.flatMap(t => api.checkTree(t)), ...b.more];
        const wrong = all.filter(x => x.result !== '相符').map(x => `${b.f} ${x.result} ${x.name} ${x.diff}`);
        assert.deepEqual(wrong, []);
        ok += all.length;
        // 否證：每條跨表規則的取數改動 1 元都要變不符（容許尾差的規則略過）
        for (const [key, fact] of Object.entries(b.facts)) {
            if (fact.v === null) continue;
            const hit = api.runChecks(b.facts).filter(r => [...r.left.parts, ...r.right.parts].some(p => p.term.replace('-', '') === key));
            fact.v += 1;
            const after = api.runChecks(b.facts);
            fact.v -= 1;
            for (const h of hit) if (!/（決算）/.test(h.name)) { assert.equal(after.find(r => r.name === h.name).result, '不符', `${b.f} ${key} 改動後「${h.name}」仍相符`); ruleFlips++; }
        }
        // 否證：預算數改動 1 元要抓到（前年度決算欄容許尾差，略過）
        for (const t of b.trees) for (const r of t.rows) r.n.forEach((v, i) => {
            if (t.tol?.[i] !== undefined) return;
            const before = api.checkTree(t).filter(x => x.result === '不符').length;
            r.n[i] = v + 1;
            const after = api.checkTree(t).filter(x => x.result === '不符').length;
            r.n[i] = v;
            if (after > before) moved++; else missed.push(`${t.title}｜${r.name}｜${t.cols[i]}`);
        });
    }
    console.log(`預算書 ${budget.length} 本：${ok} 項全部相符；改動 1 元抓到 ${moved} 格，表內沒檢查到 ${missed.length} 格（餘絀撥補預計表的未分配賸餘、待填補短絀由跨表規則檢查）；跨表規則改動 ${ruleFlips} 次全部抓到`);
    if (process.argv.includes('--dump')) console.log([...new Set(missed)].join('\n'));
}

// 否證：每條規則的每個取數都改動 1 元，該規則都要變不符（防止比到同一個數或恆真）
let flips = 0;
for (const y of Object.keys(byYear)) for (const key of [...Object.keys(byYear[y].F), ...Object.keys(byYear[y].G)]) {
    const book = key[0], fact = byYear[y][book][key];
    if (fact.v === null) continue;
    const before = rs.filter(r => r.year === +y && r.result === '相符' && [...r.left.parts, ...r.right.parts].some(p => p.term.replace('-', '') === key));
    if (!before.length) continue;
    fact.v += 1;
    const after = runAll();
    fact.v -= 1;
    for (const b of before) {
        assert.equal(after.find(r => r.year === b.year && r.name === b.name).result, '不符', `${y} ${key} 改動後「${b.name}」仍相符`);
        flips++;
    }
}
console.log(`否證 ${flips} 次全部叫了；OK`);
