// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// node tigerai/tools/make-org-sample.mjs [out.xlsx]
import { writeFileSync } from "node:fs";
import { buildXlsx, sampleOrgSheets } from "./xlsx-writer.mjs";
const out = process.argv[2] ?? "org-sample.xlsx";
writeFileSync(out, await buildXlsx(sampleOrgSheets()));
console.log(`wrote ${out}`);
