// Writes a test deck with long comparison tables to the path given (used for the PNG render check; not a test).
import { writeFileSync } from "node:fs";
const D = await import("../slides/deck.ts");
const rows = Array.from({ length: 14 }, (_, i) => [`規格項目 ${i + 1}`, `客戶 A 要求:耐壓 ${i + 10}V,材質需通過 RoHS 與 REACH 認證,交期 30 天`, `我方 B 型:耐壓 ${i + 12}V,材質符合,交期 21 天,另需確認模具費`, "可滿足"]);
const buf = await D.buildPptx({ title: "客戶規格比對", subtitle: "OpenAgent Portal 1.1.2-ce", slides: [
  { title: "規格比對表", label: "客戶 A vs B 型", points: ["先看交期,再看材質。", "耐壓高於需求的項目不需處理。"], table: { headers: ["項目", "客戶要求", "我方規格", "結論"], rows }, sources: [{ title: "客戶規格書", url: "https://example.com/spec" }, { title: "產品型錄", url: "https://example.com/cat" }] },
  { title: "短表", table: { headers: ["方案", "價格"], rows: [["A", "100"], ["B", "120"], ["C", "90"]] }, sources: [{ title: "報價單", url: "https://example.com/q" }] },
] });
writeFileSync(process.argv[2], buf);
