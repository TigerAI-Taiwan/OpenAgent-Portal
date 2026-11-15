// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import type { ComponentType } from "react";

/**
 * Page components of an add-on package, keyed by the id of the menu entry the SERVER announced for it (a component only renders
 * when the server says the package is active, so a licence that lapses removes the pages without a rebuild).
 */
export interface AddonUi {
  id: string;
  settingsTabs?: Record<string, ComponentType>;
  skillTabs?: Record<string, ComponentType>;
  /** A section of the 功能 list: gets the working folder and a function that closes the list. */
  functionSections?: Record<string, ComponentType<{ cwd: string; close: () => void }>>;
}
