// 统一前端时间展示：固定北京时间（Asia/Shanghai），不依赖浏览器本地时区。
// 仅用于「展示格式化」，不改变后端存储与 API 返回。

type DateInput = string | number | Date | null | undefined;

// 后端时间戳为 UTC，且常以「无时区后缀」的 naive ISO 形式返回（如 2026-06-07T12:14:07）。
// 这类字符串若直接交给 new Date() 会按浏览器本地时区解析，导致展示随机器时区漂移。
// 这里显式按 UTC 解析，确保展示只取决于固定的 Asia/Shanghai，而非浏览器时区。
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const normalized = NAIVE_ISO.test(trimmed) ? `${trimmed.replace(" ", "T")}Z` : trimmed;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function partsOf(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

/** 北京时间日期+时间：YYYY/MM/DD HH:mm:ss（无效输入返回 —） */
export function formatBeijingDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "—";
  const p = partsOf(date);
  // Intl 在 hour12:false 下偶尔把 00 点输出为 24，归一化为 00
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}/${p.month}/${p.day} ${hour}:${p.minute}:${p.second}`;
}

/** 北京时间「时:分:秒」：用于自动保存等只需时刻的场景（无效输入返回空串） */
export function formatBeijingClock(value: DateInput): string {
  const date = toDate(value);
  if (!date) return "";
  const p = partsOf(date);
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${hour}:${p.minute}:${p.second}`;
}
