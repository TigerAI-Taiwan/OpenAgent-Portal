// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { Type } from "typebox";
import { defineTool, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { identityForSession } from "../adapter/identity";
import { roomSpeaker } from "../rooms/speaker";
import { ServiceError } from "../accounts/service";
import { fillForm, formsFor, specOf } from "./service";

/**
 * Two tools for a conversation (members' AI has no shell, so the filling happens on the server):
 *   list_forms  the forms open to this person, with every field the AI must collect;
 *   fill_form   form_id + data -> either a list of what is missing or contradictory (nothing is written), or a link to the filled PDF.
 * The instructions added to the prompt are the other half of "never guess": ask the student, do not invent.
 */
function who(ctx: { sessionManager: { getSessionId(): string }; cwd: string }) {
  let sid: string | undefined;
  try { sid = ctx.sessionManager.getSessionId(); } catch { sid = undefined; }
  return { person: roomSpeaker(sid) ?? identityForSession(sid, ctx.cwd), inRoom: roomSpeaker(sid) !== null };
}

const RULES = [
  "你可以用 list_forms 與 fill_form 幫使用者填表。規則(嚴格):",
  "1. 先 list_forms 看有哪些表單、每個欄位要什麼;一次問使用者缺的資料,可以一次問多項。",
  "2. 絕對不要自己編造、推測或預設任何資料(生日、身分證字號、地址、是否同意…都一樣)。使用者沒說的就問。",
  "3. fill_form 回 refused 時,把 missing 與 errors 逐項用白話告訴使用者並詢問,不要自行修正後硬送;有矛盾的資料請使用者確認哪個才對。",
  "3a. fill_form 回 ask 時,表示有「建議填寫但不是必填」的欄位還是空的:一定要逐項問使用者(可以一次問完)。使用者給了值就放進 data;使用者明說不填,才把該欄位代號放進 leave_blank 再呼叫一次。不可以自己決定留白,也不可以不問就略過。",
  "4. 只有 fill_form 回 filled 才算完成;把 download_url 當連結給使用者,並轉述 left_blank(例如簽名要本人親簽)與 warnings。",
  "5. 個人資料只在個人對話填;不要把填好的內容貼到頻道。",
].join("\n");

export function createFormsExtension(): InlineExtension {
  return {
    name: "tigerai-forms",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", (event, ctx) => {
        const { person, inRoom } = who(ctx);
        if (!person || inRoom) return undefined;
        let any = false;
        try { any = formsFor(person).length > 0; } catch { any = false; }
        if (!any) return undefined;
        return { systemPrompt: `${(event as { systemPrompt?: string }).systemPrompt ?? ""}\n\n${RULES}` };
      });

      pi.registerTool(defineTool({
        name: "list_forms",
        label: "list forms",
        description: "List the forms you can fill for the user, with every field to collect (key, label, type, required, options). Call this first.",
        promptSnippet: "List the fillable forms and their fields",
        parameters: Type.Object({}),
        async execute(_id, _params, _signal, _onUpdate, ctx) {
          const { person, inRoom } = who(ctx);
          const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
          if (!person) return text("No signed-in person for this conversation.");
          if (inRoom) return text("Forms hold personal data: use this in a personal conversation, not in a channel.");
          const forms = formsFor(person);
          return text(forms.length === 0 ? "No form is open to this person." : JSON.stringify(forms.map(specOf), null, 1));
        },
      }));

      pi.registerTool(defineTool({
        name: "fill_form",
        label: "fill form",
        description: "Fill a form from the data the user gave. Returns status 'refused' with the missing and contradictory fields (nothing is written), status 'ask' when recommended fields are still empty (ask the user about each; nothing is written), or status 'filled' with a download link to the PDF. Never invent data: ask the user for anything missing.",
        promptSnippet: "Fill a form from the user's data (refuses when data is missing or contradictory)",
        parameters: Type.Object({
          form_id: Type.String({ description: "form_id from list_forms." }),
          data: Type.Record(Type.String(), Type.Unknown(), { description: "Field values by key, exactly as list_forms describes them. Nested groups (such as an address) are objects." }),
          leave_blank: Type.Optional(Type.Array(Type.String(), { description: "Keys of recommended (ask) fields the USER said to leave blank. Never add a key the user did not decline." })),
        }),
        async execute(_id, params, _signal, _onUpdate, ctx) {
          const { person, inRoom } = who(ctx);
          const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });
          if (!person) return text("No signed-in person for this conversation.");
          if (inRoom) return text("Forms hold personal data: use this in a personal conversation, not in a channel.");
          try {
            return text(JSON.stringify(await fillForm(person, String(params.form_id ?? ""), params.data, Array.isArray(params.leave_blank) ? params.leave_blank.map(String) : []), null, 1));
          } catch (error) {
            if (error instanceof ServiceError) return text(`${error.code}: ${error.message}`);
            throw error;
          }
        },
      }));
    },
  };
}
