// localStorage, not sessionStorage: Android may kill the app while the user is
// in Chrome, and the verifier must survive that restart.
export const VERIFIER_STORAGE_KEY = "404gb-oauth-verifier";
export const APP_AUTH_PREFIX = "com.fourzerofourgb.app://auth";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createVerifierPair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}
