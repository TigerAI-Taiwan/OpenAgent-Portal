# 填表工具:表單包格式與匯入

給老師(部門主管)與管理員。學生這邊沒有任何設定:在個人對話請 AI「幫我填 ○○ 申請單」,AI 會問資料、檢查、給 PDF 連結。取捨與缺口見 `DECISIONS.md`「社群版:填表工具」。

## 一個表單包 = 兩個檔案

1. **空白表單 PDF**(最大 10 MB,不能加密)。純平面或有欄位都可以;工具只在上面疊字與勾選,不讀 PDF 的表單欄位。
2. **欄位對照表**(JSON,最大 256 KB)。座標單位是 PDF 點(1/72 吋),**從頁面左上角往右、往下量**;文字的 `top` 是基線的位置。用 PyMuPDF 或 PDF 閱讀器量出每個格子的位置。

## 對照表格式

```json
{
  "version": 1,
  "ageFrom": "birthday",
  "leftBlank": ["簽名(必須本人親簽)"],
  "notes": ["給 AI 看的備註"],
  "fields": [ ... ],
  "rules":  [ ... ]
}
```

### 欄位(`fields`)

每個欄位都有 `key`(小寫英數與底線)、`label`(中文名稱,AI 問學生時用)、可選 `required`、`hint`。

`ask: true`(1.1.2-ce)= 「建議填寫、但不是必填」(例如報價單的報價有效期限):欄位還是空的時候,`fill_form` 回 `status: "ask"` 並列出這些欄位,**什麼都不輸出**;AI 必須問使用者,使用者給了值就放進 `data`,使用者明說不填才把欄位代號放進 `leave_blank` 再送一次。必填欄位不能加 `ask`(匯入時整包不收)。

| `type` | 說明 | 重要屬性 |
|---|---|---|
| `text` | 文字 | `pattern`(正規表示式)、`patternHint`、`minLength`/`maxLength`、`validator: "tw-id"`(身分證檢查碼)、`slot`(寫在哪)、`stripSuffix`(表單已印的字尾,例如「縣市」,值尾端剛好是它就去掉)、`splitOn` + `slots`(「02-12345678」分兩格寫)、`virtual: true`(只檢查、不寫) |
| `choice` | 單選 | `options`: `{ "代號": { "label": "中文", "check": {x,y} 或 "circle": {x0,x1,y0,y1} } }`、`default`(表單本身印好的預設) |
| `multi` | 複選(清單) | `options` 同上 |
| `bool` | 是/否 | `check`、`mustBeTrue`(必須是 true 才算有填,例如「已閱讀同意書」) |
| `date` | 日期,學生給 `YYYY-MM-DD`(西元) | `parts`: `year` / `month` / `day` 各一個 `slot`;`eraField`(哪個選項欄位選了 `roc` 就寫民國年)、`rocYear`(一律寫民國年)、`notFuture` |
| `group` | 一組文字(例如地址) | `fields`: 一串有 `slot` 的 `text`;鍵名是 `欄位.子欄位` |

`slot`:`{ "page": 0, "x0": 340, "x1": 414, "top": 222, "size": 12, "minSize": 5.5, "align": "center" }`。文字置中在 `x0`–`x1` 內,太長會自動縮小到 `minSize`,縮不下就拒絕。

### 規則(`rules`)

| `type` | 意思 |
|---|---|
| `requires` | `if` 條件成立時,`fields` 都必須有(缺 → 列為缺少) |
| `forbids` | `if` 成立時,`fields` 不可出現(出現 → 互相矛盾,用 `message`) |
| `conflict` | `when` 的條件全部成立 → 矛盾(`severity: "warning"` 只提醒不擋);訊息裡的 `{age}` 會換成年齡 |
| `exactlyOne` | `fields` 要剛好填一個(都沒有 → 缺少;兩個以上 → 矛盾;`false` 不算填) |
| `age-matches` | 學生自己說的年齡欄位要等於由生日算出來的年齡 |

條件:`{ "field": "card_type", "eq": "family" }`,可用 `eq ne in notIn present includes excludes gte gt lte lt matches`;欄位名稱可以是 `address.city`;特別欄位 `$age` 是由 `ageFrom` 的日期算出的年齡。

完整範例:`learning-agent` 教材資料夾裡的新北市立圖書館借閱證申請單(`q2-library/form-package/`:PDF、`ntpc_individual_card.def.json`、產生它的 `build_def.py`)。這份表單的版權未經館方確認,所以不放在公開 repo。

## 匯入

1. 設定 → 管理 → 表單 → **匯入表單**:名稱、說明、開放給哪些部門(主管只能選自己主管的部門)、選 PDF 與 JSON。
2. 伺服器先檢查對照表:欄位代號重複、座標超出頁面、規則指向不存在的欄位、選項沒有任何標記、正規表示式不合,任何一項都整包不收並列出原因。
3. 按表單旁的 **檢查範例資料**:貼一份 JSON,看缺哪些、哪裡矛盾;只檢查,不輸出、不留存。
4. 用學生帳號在對話裡實際請 AI 填一次,打開 PDF,確認每個字都落在格子裡(座標只能看了才知道)。

## 字型(一次性,管理員)

輸出需要一個同時有**中文與英數字**的 **TrueType 字型檔(.ttf)**:

- 只有中文的字型(例如 Droid Sans Fallback)不行:數字欄會被拒絕(缺字檢查)。
- `.otf`(OpenType-CFF,例如思源黑體的 OTF 版)與 `.ttc`(合集)**不收**:實測 pdf-lib 能嵌入 CFF,但產出的 PDF 在 poppler 等檢視器會報「Embedded font file may be invalid」。同一個字面存成 `.ttf` 就正常。設定頁與填表都會明說原因。
- 建議 Noto Sans TC(SIL OFL 1.1,授權允許內嵌到產出的 PDF)的**靜態 .ttf**(Google Fonts 下載);只有 OTF 或 TTC 時,用 fonttools 取出並轉成 TrueType:`python3 -c "from fontTools.ttLib import TTCollection; TTCollection('x.ttc').fonts[N].save('x.ttf')"`(`.ttc` 若本身是 TrueType 輪廓,如文鼎 AR PL UMing);CFF 輪廓要先用 `otf2ttf`(fonttools 附的 cu2qu)轉換。

**Google Fonts 的 Noto Sans TC 只有可變字型(`NotoSansTC[wght].ttf`),直接用會缺字。** 實測(2026-11-15,新北借閱證範例):pdf-lib 的 fontkit 子集化會悄悄漏掉部分字(姓名、數字),PDF 能開、文字層正確、畫面卻是空白;Noto Sans TC、Chocolate Classical Sans、Iansui 都重現,文鼎 UMing 正常。因此安裝人員要先用 fonttools 做成**靜態、預先子集化**的小字型,系統看到 8 MB 以下的字型就整個嵌入(不走子集化),輸出 PDF 約 3 MB:

```bash
# 1. 取得(固定 commit;OFL 授權檔 OFL.txt 在同一資料夾,要一併保留)
curl -L -o NotoSansTC-VF.ttf 'https://raw.githubusercontent.com/google/fonts/3be1884c48c3e45b52ecc725676a08f87776373e/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf'
# 2. 取出 Regular(wght=400)靜態實例
fonttools varLib.instancer NotoSansTC-VF.ttf wght=400 -o NotoSansTC-Regular.ttf
# 3. 只留 Big5 字集 + 英數 + 標點(unicodes.txt 由 python 的 big5 編碼表產生,約 14000 字),去掉 hinting 與版面表
pyftsubset NotoSansTC-Regular.ttf --unicodes-file=unicodes.txt --no-hinting --layout-features='' --drop-tables+=GSUB,GPOS,GDEF,vhea,vmtx --output-file=NotoSansTC-Regular-Big5.ttf
```

成品(4.8 MB)已備好,放在安裝包的 `form-package/fonts/NotoSansTC-Regular-Big5.ttf`(附 `OFL.txt`、`SOURCE.txt`),**不放進公開 repo**。安裝時複製到資料目錄 `forms/fonts/`。字型更動(子集化)後保留原授權檔;OFL 的保留字型名是 "Source",不影響以 Noto Sans TC 名稱散布。

放到資料目錄的 `forms/fonts/`,或設 `TIGERAI_FORM_FONT=/path/to/font.ttf`。沒有可用字型時,設定頁會警告、填表被拒絕(檢查資料仍可用)。

## 保留與權限

填好的 PDF 在 `<資料目錄>/forms/out/`(600 權限),預設 30 天後自動刪除(`TIGERAI_FORM_RETENTION_DAYS`)。下載:本人、學生所屬部門的主管、管理員。學生填的值除了那份 PDF 以外不存在任何地方。簽名、館方欄一律留白,表單由本人親簽。
