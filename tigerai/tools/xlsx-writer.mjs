// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// Writes a plain .xlsx (text cells only, optional drop-down lists). Used for the sample org sheet and in tests.
import JSZip from "jszip";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => String.fromCharCode(65 + i);

/** sheets: [{ name, rows: string[][], dropdowns?: [{ col: 'C', values: string[] }] , formulaCell?: boolean }] */
export async function buildXlsx(sheets) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  sheets.forEach((s, i) => {
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      if (s.formulaCell && ri === 1 && ci === 0) return `<c r="${ref}"><f>1+1</f><v>2</v></c>`;
      return v === "" ? "" : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const dv = (s.dropdowns ?? []).map((d) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${d.col}2:${d.col}5000"><formula1>"${esc(d.values.join(","))}"</formula1></dataValidation>`).join("");
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${dv ? `<dataValidations count="${(s.dropdowns ?? []).length}">${dv}</dataValidations>` : ""}</worksheet>`);
  });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** The sample organisation sheet (org.xlsx format: units / members / lists). */
export function sampleOrgSheets(prefix = "") {
  const em = (n) => `${prefix.toLowerCase()}${n}@example.com`;
  return [
    { name: "units", rows: [["name", "parent", "description", "managers", "confirmers"], [`${prefix}Acme Corp`, "", "Whole company", "", ""], [`${prefix}Sales`, `${prefix}Acme Corp`, "Sales department", em("sam"), ""], [`${prefix}Support`, `${prefix}Acme Corp`, "Customer support", em("kim"), ""]] },
    {
      name: "members",
      rows: [["action", "email", "employeeId", "name", "role", "status", "units"],
        ["hire", em("sam"), "", `${prefix}Sam`, "member", "", `${prefix}Sales`],
        ["hire", em("pat"), "", `${prefix}Pat`, "member", "", `${prefix}Sales`],
        ["hire", em("kim"), "", `${prefix}Kim`, "member", "", `${prefix}Support`]],
      dropdowns: [{ col: "A", values: ["hire", "leave"] }, { col: "E", values: ["admin", "member"] }],
    },
    { name: "lists", rows: [["action", "role"], ["hire", "admin"], ["leave", "member"]] },
  ];
}
