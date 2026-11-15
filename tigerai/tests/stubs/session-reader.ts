export async function resolveSessionPath(): Promise<null> { return null; }
export async function listAllSessions(): Promise<never[]> { return []; }
export function invalidateSessionPathCache(): void { /* tests have no session files */ }
export function invalidateSessionManagerCache(): void { /* tests have no session files */ }
