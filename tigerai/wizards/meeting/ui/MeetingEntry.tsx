"use client";
// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// The 會議摘要 row at the top of the 精靈 list (rendered by AgentsModal). A built-in wizard: not an agent of the person's menu.
import { useState } from "react";
import MeetingModal from "./MeetingModal";
import { mt } from "./texts";

export default function MeetingEntry() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="tga-row" data-tg-wizard="meeting">
        <button type="button" className="tga-main" onClick={() => setOpen(true)}>
          <span className="tga-name">{mt("title")}</span>
          <span className="tga-desc">{mt("entryDesc")}</span>
        </button>
        <span className="tga-acts"><button type="button" className="tgx-btn primary" onClick={() => setOpen(true)}>{mt("start")}</button></span>
      </div>
      {open && <MeetingModal onClose={() => setOpen(false)} />}
    </>
  );
}
