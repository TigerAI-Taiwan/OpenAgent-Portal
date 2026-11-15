// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathAllowed } from "../adapter/path-guard.ts";

const root = mkdtempSync(join(process.env.TIGERAI_TEST_TMP ?? tmpdir(), "tg-guard-"));
const mine = join(root, "mine");
const other = join(root, "other");
mkdirSync(mine); mkdirSync(other);
writeFileSync(join(mine, "a.txt"), "x"); writeFileSync(join(other, "secret.txt"), "y");
symlinkSync(other, join(mine, "link"));

test("inside the folder", () => {
  assert.ok(pathAllowed(mine, undefined));
  assert.ok(pathAllowed(mine, "a.txt"));
  assert.ok(pathAllowed(mine, join(mine, "a.txt")));
  assert.ok(pathAllowed(mine, "@a.txt"));
  assert.ok(pathAllowed(mine, "not-yet-created/file.txt"));
});
test("outside the folder", () => {
  assert.ok(!pathAllowed(mine, "/etc/passwd"));
  assert.ok(!pathAllowed(mine, "../other/secret.txt"));
  assert.ok(!pathAllowed(mine, join(other, "secret.txt")));
  assert.ok(!pathAllowed(mine, "~/.ssh/id_rsa"));
  assert.ok(!pathAllowed(mine, "link/secret.txt"), "a symlink out of the folder is followed and refused");
  assert.ok(!pathAllowed(mine, 42));
  assert.ok(!pathAllowed(mine, "a/../../other/secret.txt"));
});
