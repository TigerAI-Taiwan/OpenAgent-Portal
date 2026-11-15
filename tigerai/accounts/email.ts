// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
/**
 * One email rule for accounts and the org import. A single-label domain is valid on purpose: an intranet install's first
 * administrator is usually `adm@local`. Still rejected: no @, spaces, a second @, an empty or dotted-over domain label.
 */
export const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*$/;
