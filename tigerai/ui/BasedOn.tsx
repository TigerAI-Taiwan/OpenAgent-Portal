"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { BRAND_BASED_ON, BRAND_UPSTREAM } from "@/lib/brand";

/** "based on pi-agent and pi-web", each name a link to its project. Shown on the login page and in the product-name popup. */
export function BasedOn({ style }: { style?: React.CSSProperties }) {
  return (
    <span data-tg-based-on style={{ fontSize: 12, color: "var(--text-muted)", ...style }}>
      {BRAND_BASED_ON.split(/(pi-agent|pi-web)/).map((part, i) => {
        const up = BRAND_UPSTREAM.find((u) => u.name === part);
        return up ? <a key={i} href={up.href} target="_blank" rel="noreferrer noopener" style={{ color: "inherit", textDecoration: "underline" }}>{part}</a> : <span key={i}>{part}</span>;
      })}
    </span>
  );
}
