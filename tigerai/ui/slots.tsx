"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// The only thing upstream files call: <TgSlot name=".." ctx={..}>{upstream element}</TgSlot> and useTg().
// A slot renders what tigerai registers for it, else the upstream children. If our part throws, the error is
// logged and the upstream children are rendered, so a fault here can never blank the screen. Permission
// checks live on the server; nothing here is a security boundary.
import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { upstreamVisible, type SlotName } from "./layout";
import { useMe, type MeState } from "./me";
import { BellButton, BrandTitle, BrandVersion, FunctionsButton, NewButton, RoomListExtra, SidebarBottom, SignOutButton } from "./parts";
import { IdleWatcher } from "./IdleWatcher";
import { ComposerState } from "./ComposerState";
import { SenderBridge, TruncationActions } from "./truncation";
import { FallbackNote } from "./FallbackNote";

const RoomView = dynamic(() => import("./RoomView"), { ssr: false });

export type SlotCtx = Record<string, unknown>;
type Render = (ctx: SlotCtx, s: MeState, upstream: ReactNode) => ReactNode | undefined;

/** One entry per slot. undefined = not mine (upstream renders), null = render nothing. */
const REGISTRY: Record<SlotName, Render> = {
  "brand.version": () => <BrandVersion />,
  "brand.title": () => <BrandTitle />,
  "composer.state": (ctx, _s, upstream) => <ComposerState sessionId={(ctx.sessionId as string | undefined) ?? null}>{upstream}</ComposerState>,
  "composer.functions": (ctx) => <FunctionsButton cwd={(ctx.cwd as string | null | undefined) ?? null} />,
  "sidebar.new": (ctx) => <NewButton onNewChat={ctx.onNewChat as () => void} anchor={(ctx.anchor as string | null) ?? null} ready={ctx.ready === true} />,
  "sidebar.list.extra": (ctx) => <RoomListExtra anchor={(ctx.anchor as string | null) ?? null} />,
  "sidebar.bottom": (ctx) => <SidebarBottom openUpstream={ctx.openUpstream as (section: string) => void} />,
  "toolbar.right": () => <><IdleWatcher /><BellButton /><SignOutButton /></>,
  "toolbar.tabs": (_c, s, upstream) => (s.status === "on" && !upstreamVisible("toolbar.tabs", s.me) ? null : upstream),
  "onboarding.models": (_c, s) => (s.status === "on" && upstreamVisible("onboarding.models", s.me) ? undefined : null),
  "chat.truncation": (ctx, s) => <TruncationActions unanswered={ctx.unanswered === true} sessionId={(ctx.sessionId as string | undefined) ?? null} streaming={ctx.isStreaming === true} canCompact={ctx.canCompact === true} onCompact={ctx.onCompact as () => void} compacting={ctx.isCompacting === true} admin={s.me?.role === "admin"} />,
  "chat.sender": (ctx) => <><SenderBridge sessionId={(ctx.sessionId as string | undefined) ?? null} send={ctx.send as (text: string) => unknown} busy={ctx.busy === true} /><FallbackNote sessionId={(ctx.sessionId as string | undefined) ?? null} busy={ctx.busy === true} /></>,
  "main.override": (ctx, _s, upstream) => <RoomView anchor={(ctx.anchor as string | null) ?? null} upstream={upstream} />,
};

class Boundary extends Component<{ name: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(`[tigerai] slot ${this.props.name} failed, showing upstream:`, error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function TgSlot({ name, ctx = {}, children = null }: { name: SlotName; ctx?: SlotCtx; children?: ReactNode }) {
  const s = useMe();
  // Off (module disabled) or not loaded yet: exactly upstream. Restricted elements are gated by useTg().keep and the server.
  if (s.status !== "on") return <>{children}</>;
  let mine: ReactNode | undefined;
  try { mine = REGISTRY[name](ctx, s, children); } catch (error) { console.error(`[tigerai] slot ${name} failed:`, error); mine = undefined; }
  if (mine === undefined) return <>{children}</>;
  return <Boundary name={name} fallback={children}>{mine}</Boundary>;
}

/** For upstream elements that only some roles keep: `if (!tg.keep("composer.model")) skip it`. Hidden until known. */
export function useTg(): { keep: (element: string) => boolean; text: (key: string, fallback: string) => string; homeCwd: string | null } {
  const s = useMe();
  return {
    homeCwd: s.status === "on" ? s.me?.homeDir ?? null : null,
    keep: (element) => (s.status !== "on" ? true : upstreamVisible(element, s.me)),
    text: (key, fallback) => (s.status === "on" ? TEXTS[key]?.() ?? fallback : fallback),
  };
}
import { tr, type Key } from "../pages/i18n";
// Texts upstream has hard-coded in English, keyed by the name the upstream call point passes; add a line here to translate another.
const TEXTS: Record<string, () => string> = {
  "composer.placeholder": () => tr("placeholder"),
  // One text for the thinking level everywhere (the collapsed composer button, the dropdown rows, the home page): 「推理:中等」.
  ...Object.fromEntries((["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((l) => [`composer.thinking.${l}`, () => `${tr("thinkPrefix")}:${tr(`think${l[0].toUpperCase()}${l.slice(1)}` as Key)}`])),
  "composer.tools.configured": () => tr("configuredLabel"),
};

export { RoomView };
