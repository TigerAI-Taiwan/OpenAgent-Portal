// 1.1.2-ce item 4: a comparison table never reaches the 資料來源 strip or the page edge; surplus rows continue on a (續) slide.
import test from "node:test";
import assert from "node:assert/strict";
const D = await import("../slides/deck.ts");

const longRows = Array.from({ length: 14 }, (_, i) => [`規格項目 ${i + 1}`, `客戶 A 要求:耐壓 ${i + 10}V,材質需通過 RoHS 與 REACH 認證,交期 30 天`, `我方 B 型:耐壓 ${i + 12}V,材質符合,交期 21 天,另需確認模具費`, "可滿足"]);
const deck = {
  title: "客戶規格比對", subtitle: "x",
  slides: [
    { title: "規格比對表", label: "客戶 A vs B 型", points: ["先看交期,再看材質。", "耐壓高於需求的項目不需處理。"], table: { headers: ["項目", "客戶要求", "我方規格", "結論"], rows: longRows }, sources: [{ title: "客戶規格書", url: "https://example.com/spec" }, { title: "產品型錄", url: "https://example.com/cat" }] },
    { title: "短表", table: { headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]] }, sources: [{ title: "s", url: "https://example.com/s" }] },
    { title: "沒有來源的長表", table: { headers: ["項目", "內容"], rows: longRows.map((r) => [r[0], r[1]]) } },
  ],
};

test("no shape reaches the sources strip or the page bottom, and no row is lost", () => {
  const specs = D.planDeck(deck);
  let tableSlides = 0, cells = 0;
  for (const sp of specs) {
    const src = sp.shapes.find((s) => s.y === D.SOURCES_TOP);
    for (const sh of sp.shapes) {
      assert.ok(sh.y + sh.h <= 7.5 + 1e-6, `shape bottom ${sh.y + sh.h} beyond the page`);
      if (src && sh !== src && sh.y < D.SOURCES_TOP) assert.ok(sh.y + sh.h <= D.SOURCES_TOP + 1e-6, `shape (${sh.y}+${sh.h}) overlaps the sources strip`);
    }
    if (sp.shapes.some((s) => s.fill === "1F4E79" && s.paras.length && s.paras[0][0].bold && s.paras[0][0].color === "FFFFFF" && s.y > 1)) tableSlides++;
    cells += sp.shapes.filter((s) => s.fill === "EEF3F8" || (s.paras[0]?.[0]?.size === 13 && s.fill === "FFFFFF")).length;
  }
  assert.ok(tableSlides >= 4, `the long tables continue on more slides (${tableSlides})`);
  // every data row of the first deck slide appears exactly once across slides
  const text = specs.flatMap((sp) => sp.shapes.flatMap((s) => s.paras.flat().map((p) => p.text)));
  for (let i = 1; i <= 14; i++) assert.equal(text.filter((t) => t === `規格項目 ${i}`).length, 2, `row ${i}: once in the sourced table and once in the unsourced one`);
  assert.ok(text.some((t) => t === "資料來源"));
  assert.ok(specs.some((sp) => sp.shapes.some((s) => s.paras[0]?.[0]?.text?.endsWith("(續)"))));
});
test("the header repeats on continuation slides; the sources show on the last slide of the table only", () => {
  const specs = D.planDeck({ ...deck, slides: [deck.slides[0]] });
  const withSrc = specs.filter((sp) => sp.shapes.some((s) => s.y === D.SOURCES_TOP));
  assert.equal(withSrc.length, 1);
  assert.equal(specs.indexOf(withSrc[0]), specs.length - 2 /* the references slide follows */);
  const cont = specs.filter((sp) => sp.shapes.some((s) => s.paras[0]?.[0]?.text === "規格比對表(續)"));
  assert.ok(cont.length >= 1);
  for (const c of cont) assert.ok(c.shapes.some((s) => s.paras[0]?.[0]?.text === "項目" && s.fill === "1F4E79"), "header row repeated");
});
test("a small table still sits on one slide next to its sources", () => {
  const specs = D.planDeck({ ...deck, slides: [deck.slides[1]] });
  assert.equal(specs.filter((sp) => sp.shapes.some((s) => s.paras[0]?.[0]?.text?.startsWith("短表"))).length, 1);
});
