import { stableStringify } from "@labelhub/schema-core";

export async function hashCanonicalJson(value: unknown): Promise<string | undefined> {
  let canonical: string;
  try {
    canonical = stableStringify(value);
  } catch (error) {
    console.warn("生成 canonical-json-v1 字符串失败，已省略 hash 字段：", error);
    return undefined;
  }
  return sha256Hex(canonical);
}

export async function sha256Hex(input: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    console.warn("当前 mock 环境不支持 Web Crypto SHA-256，已省略 hash 字段。");
    return undefined;
  }

  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
