// SPDX-License-Identifier: LicenseRef-TigerAI-SUL-Draft
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

// PBKDF2-SHA512 from node:crypto (no extra dependency). The iteration count is
// stored per account so it can be raised later without invalidating old hashes.
const ITERATIONS = 210_000;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 8;

export interface PasswordCredential { hash: string; salt: string; iterations: number }

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 1024) return "Password is too long";
  return null;
}

export function hashPassword(password: string): PasswordCredential {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha512");
  return { hash: hash.toString("base64url"), salt: salt.toString("base64url"), iterations: ITERATIONS };
}

/** Always runs one hash, even for an unknown account, so timing does not reveal which emails exist. */
export function verifyPassword(password: string, credential: PasswordCredential | null): boolean {
  const cred = credential ?? {
    hash: Buffer.alloc(KEY_LENGTH).toString("base64url"),
    salt: Buffer.alloc(16).toString("base64url"),
    iterations: ITERATIONS,
  };
  const expected = Buffer.from(cred.hash, "base64url");
  const salt = Buffer.from(cred.salt, "base64url");
  let actual: Buffer;
  try {
    actual = pbkdf2Sync(password, salt, cred.iterations, expected.length || KEY_LENGTH, "sha512");
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected) && credential !== null;
}

/** Random initial password: 16 chars, no look-alike characters. */
export function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
