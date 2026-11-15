// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { Type } from "typebox";
import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { writeAudit } from "../accounts/audit";
import { ServiceError, userById } from "../accounts/service";
import { identityForSession } from "../adapter/identity";
import { getOwner, isRoomMember } from "../rooms/ownership";
import { roomSpeaker } from "../rooms/speaker";
import { rateLimitHit } from "../web/service";
import { buildPptx, type DeckIn, type Source } from "./deck";
import { convertToPdf, converterConfigured } from "./convert";
import { saveDeck } from "./store";

/**
 * Tool make_slides: the AI writes the deck as structured data, the server renders a 16:9 .pptx with the built-in template, converts it
 * to PDF through the 文件轉檔服務 when one is set up, stores both and returns download links for the AI to post. Everything the model
 * passes is cleaned here (counts, lengths, only http(s) links); nothing is fetched while rendering.
 */

const MAX_SLIDES = 40;
const strs = (v: unknown, n: number, len: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, n).map((x) => x.slice(0, len)) : []);
function sources(v: unknown, n: number): Source[] {
  if (!Array.isArray(v)) return [];
  const out: Source[] = [];
  for (const r of v as { title?: unknown; url?: unknown }[]) {
    try {
      const u = new URL(String(r?.url));
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      out.push({ title: String(r?.title ?? u.hostname).trim().slice(0, 120) || u.hostname, url: u.toString().slice(0, 500) });
    } catch { /* not a URL: dropped, never shown as a link */ }
    if (out.length >= n) break;
  }
  return out;
}

export function cleanDeck(input: Record<string, unknown>): DeckIn {
  const slides = (Array.isArray(input.slides) ? input.slides : []).slice(0, MAX_SLIDES).map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const t = (s.table ?? null) as { headers?: unknown; rows?: unknown } | null;
    const headers = strs(t?.headers, 5, 40);
    return {
      title: String(s.title ?? "").trim().slice(0, 100) || "(無標題)",
      label: typeof s.label === "string" ? s.label.trim().slice(0, 100) : undefined,
      points: strs(s.points, 20, 400),
      sources: sources(s.sources, 4),
      table: headers.length && Array.isArray(t?.rows) ? { headers, rows: (t!.rows as unknown[]).slice(0, 30).map((r) => strs(r, 5, 80)) } : undefined,
    };
  });
  if (slides.length === 0) throw new ServiceError("no_slides", "Give at least one slide");
  return { title: String(input.title ?? "").trim().slice(0, 100) || "簡報", subtitle: typeof input.subtitle === "string" ? input.subtitle.trim().slice(0, 200) : undefined, slides, references: sources(input.references, 30) };
}

const safeName = (t: string) => t.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 60) || "slides";

export function createSlidesExtension(): InlineExtension {
  return {
    name: "tigerai-slides",
    hidden: true,
    factory: (pi) => {
      pi.registerTool(defineTool({
        name: "make_slides",
        label: "Make slides",
        description: [
          "Make a 16:9 slide deck (editable .pptx, plus a PDF when the server can convert) and return download links to post in the chat.",
          "Plan: a title slide is added for you; then give one slide per student viewpoint (label = the student's name, points = the key points, sources = the references used), a comparison slide (table), a conclusion / next-steps slide.",
          "A references slide is added for you from every slide's sources. Keep each point to one short sentence (at most 6 points per slide). Only use URLs that web_search or web_fetch returned.",
        ].join(" "),
        promptSnippet: "Make a slide deck (.pptx and PDF) and get download links",
        parameters: Type.Object({
          title: Type.String({ description: "Deck title." }),
          subtitle: Type.Optional(Type.String({ description: "Course, group or date line." })),
          slides: Type.Array(Type.Object({
            title: Type.String(),
            label: Type.Optional(Type.String({ description: "Small line under the title, e.g. the student's name." })),
            points: Type.Optional(Type.Array(Type.String())),
            sources: Type.Optional(Type.Array(Type.Object({ title: Type.String(), url: Type.String() }))),
            table: Type.Optional(Type.Object({ headers: Type.Array(Type.String()), rows: Type.Array(Type.Array(Type.String())) })),
          })),
          references: Type.Optional(Type.Array(Type.Object({ title: Type.String(), url: Type.String() }), { description: "Extra references for the last slide." })),
        }),
        async execute(_id, params, _signal, _update, ctx) {
          const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
          let sid: string | undefined; try { sid = ctx.sessionManager.getSessionId(); } catch { sid = undefined; }
          const person = roomSpeaker(sid) ?? identityForSession(sid, ctx.cwd);
          const u = person ? userById(person.id) : null;
          if (!person || !u || u.status !== "active") return text("Slides can only be made for a signed-in person.");
          const roomId = (sid && getOwner(sid)?.room_id) || null;
          if (roomId && !isRoomMember(roomId, person.id)) return text("Only a member of this channel can make slides in it.");
          if (rateLimitHit(person.id, "slides")) return text("Too many requests in the last minute. Wait a little and try again.");
          try {
            const deck = cleanDeck(params as unknown as Record<string, unknown>);
            const pptx = await buildPptx({ ...deck, author: roomId ? undefined : u.name });
            let pdf: Buffer | null = null; let note = "";
            if (!converterConfigured()) note = "PDF conversion is not set up on this server, so only the editable .pptx was made. Tell the person to ask the administrator to set up 文件轉檔服務.";
            else { try { pdf = await convertToPdf(pptx); } catch (e) { note = `The PDF could not be made (${e instanceof Error ? e.message : "conversion failed"}); the editable .pptx is available.`; } }
            const meta = saveDeck({ roomId, ownerId: person.id, title: deck.title, slides: deck.slides.length + 1, pptx, pdf, pdfNote: note || undefined });
            writeAudit("slides.make", person.id, { deck: meta.id, title: deck.title, room: roomId, slides: meta.slides, pdf: !!pdf });
            const name = safeName(deck.title);
            const base = `/api/tg/slides/${meta.id}`;
            return text([
              `The deck "${deck.title}" is ready (${meta.slides} slides${roomId ? ", saved in this channel; every member can download it" : ", saved in your own conversation list"}).`,
              pdf ? `Post these two links in your answer exactly as written:\n- PDF (to present): [${name}.pdf](${base}?format=pdf)\n- PowerPoint (to edit): [${name}.pptx](${base}?format=pptx)` : `Post this link in your answer exactly as written:\n- PowerPoint (to edit): [${name}.pptx](${base}?format=pptx)`,
              note,
            ].filter(Boolean).join("\n"));
          } catch (e) { return text(e instanceof ServiceError ? e.message : "The deck could not be made."); }
        },
      }));
    },
  };
}
