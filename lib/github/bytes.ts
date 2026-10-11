// Byte helpers without Node's Buffer: base64 for the Git Data API, UTF-8 for repo texts,
// and WebCrypto digests.

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

export function utf8Bytes(text: string): Bytes {
  return encoder.encode(text);
}

export function utf8Text(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** UTF-8 size of `text` without encoding it (lone surrogates count as U+FFFD, like TextEncoder). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Decodes base64, ignoring the line breaks GitHub puts in `content`. */
export function base64ToBytes(base64: string): Bytes {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexOf(data: BufferSource): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export async function sha1HexOf(data: BufferSource): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-1", data));
}
