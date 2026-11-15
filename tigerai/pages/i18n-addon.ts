// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
// 顧問包 page (設定 › 管理 › 顧問包). Its own file so the big table in i18n.ts stays untouched.
export const zhAddon = {
  tabAddon: "顧問包",
  addonIntro: "社群版是單純的本地版 Agent Portal(含簡易的 n8n Webhook 示範)。顧問包是另外授權的加值包,由虎智或認證顧問為你的公司導入,沒有安裝時這些功能完全不存在。",
  addonStatus: "目前狀態",
  addonNone: "未安裝",
  addonOn: "已安裝,版本 {version}", addonExpires: "授權到期日 {date}",
  addonOff: "已安裝(版本 {version}),但授權沒有生效",
  addonWhy_missing: "找不到授權檔", addonWhy_unreadable: "授權檔讀不了", addonWhy_bad_signature: "授權檔簽章不正確", addonWhy_bad_payload: "授權檔格式不正確",
  addonWhy_expired: "授權已到期", addonWhy_feature_missing: "授權沒有包含這個顧問包的功能", addonWhy_disabled: "TigerAI 模組沒有啟用",
  addonWhatTitle: "顧問包會多哪些功能",
  addonWhat1: "系統連接(MCP 集成區):n8n、Gitea、Zabbix、自訂範本,依群組開放、只開唯讀工具、全程稽核",
  addonWhat2: "n8n 排程與版本紀錄:精靈排程改由 n8n 控制(內建排程自動退讓)、Gitea 存檔與版本紀錄",
  addonWhat3: "導入工具:顧問匯入、全公司部門頻道自動建立、營運飛輪專案與 60 條流程範本",
  addonWhat4: "安裝與接上:n8n、Gitea 的 docker 安裝與接上 Portal,由顧問包負責",
  addonContactTitle: "如何取得",
  addonContact: "請洽虎智或認證顧問。授權是一個簽章過的授權檔,放進伺服器的顧問包資料夾後重新整理本頁即可生效。",
};
export const enAddon: Partial<Record<keyof typeof zhAddon, string>> = {
  tabAddon: "Consultant pack",
  addonIntro: "The community edition is a plain local Agent Portal. The consultant pack is a separately licensed add-on that 虎智 or a certified consultant sets up for your company; without it none of these features exist.",
  addonStatus: "Status", addonNone: "Not installed", addonOn: "Installed, version {version}", addonExpires: "licence valid until {date}",
  addonOff: "Installed (version {version}) but the licence is not in effect",
  addonWhy_missing: "licence file not found", addonWhy_unreadable: "licence file unreadable", addonWhy_bad_signature: "licence signature is wrong", addonWhy_bad_payload: "licence file is malformed",
  addonWhy_expired: "licence expired", addonWhy_feature_missing: "licence does not include this pack", addonWhy_disabled: "TigerAI module is off",
  addonWhatTitle: "What the pack adds",
  addonWhat1: "System connections (MCP integration): n8n, Gitea, Zabbix and custom templates, by group, read-only tools by default, fully audited",
  addonWhat2: "n8n schedule and version records: the wizard schedule driven by n8n (the built-in one steps aside), Gitea archive and version history",
  addonWhat3: "Onboarding tools: consultant import, company-wide department channels, operating-flywheel projects and 60 process templates",
  addonWhat4: "Installation: n8n and Gitea installed with docker and connected to the Portal by the pack",
  addonContactTitle: "How to get it",
  addonContact: "Contact 虎智 or a certified consultant. A licence is a signed file; put it in the server's add-on folder and reload this page.",
};
