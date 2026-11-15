"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// The 會議摘要 row at the top of the 精靈 list (rendered by AgentsModal). A built-in wizard: not an agent of the person's menu.
import { useState } from "react";
import MeetingModal from "./MeetingModal";
import { useUi } from "../../../ui/store";
import { mt } from "./texts";

export default function MeetingEntry() {
  const [open, setOpen] = useState(false);
  // Started while a channel is on screen (and the person is a member of it): offer to post the summary there too, ticked by default.
  const ui = useUi();
  const room = ui.roomId ? ui.rooms.find((r) => r.id === ui.roomId && r.isMember !== false && !r.closed) ?? null : null;
  return (
    <>
      <div className="tga-row" data-tg-wizard="meeting">
        <button type="button" className="tga-main" onClick={() => setOpen(true)}>
          <span className="tga-name">{mt("title")}</span>
          <span className="tga-desc">{mt("entryDesc")}</span>
        </button>
        <span className="tga-acts"><button type="button" className="tgx-btn primary" onClick={() => setOpen(true)}>{mt("start")}</button></span>
      </div>
      {open && <MeetingModal roomChoice={room ? { id: room.id, name: room.name } : null} onClose={() => setOpen(false)} />}
    </>
  );
}
