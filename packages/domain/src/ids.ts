const ACE_ID = /^[a-f0-9]{40}$/i;

/** Acepta el hex de 40 caracteres o el esquema acestream://. */
export function normalizeAceId(input: string): string | null {
  const bare = input.trim().replace(/^acestream:\/\//i, "").split(/[?#]/)[0] ?? "";
  if (!ACE_ID.test(bare)) return null;
  return bare.toLowerCase();
}
