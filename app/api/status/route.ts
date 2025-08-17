// /app/api/radio/status/route.ts
import type { NextRequest } from "next/server";

const BASE = "http://sonicpanel.oficialserver.com:8342";
const STREAM_URL = `${BASE}/;`;
const CANDIDATES = [
  `${BASE}/index.html?sid=1`,
  `${BASE}/index.html`,
  `${BASE}/`,
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114 Safari/537.36";

function abs(base: string, url: string) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function decodeHtml(s: string) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function textify(html: string) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|td|th|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtml(cleaned)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function getLabelFromHtml(html: string, labelRegex: string) {
  // Padrão tabela
  let re = new RegExp(
    `<td[^>]*>\\s*${labelRegex}\\s*:\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
    "i"
  );
  let m = html.match(re);
  if (m) return decodeHtml(m[1].replace(/<[^>]+>/g, "").trim());

  // Padrão inline (Label: valor<br>)
  re = new RegExp(
    `${labelRegex}\\s*:\\s*([\\s\\S]*?)(?:<br[^>]*\\/?\\s*>|<\\/td>|<\\/tr>|<\\/p>|<hr|\\n)`,
    "i"
  );
  m = html.match(re);
  if (m) return decodeHtml(m[1].replace(/<[^>]+>/g, "").trim());

  return null;
}

function getLabelFromText(text: string, label: string) {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "i");
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function extractListeners(html: string, text: string, statusText: string | null) {
  let current: number | null = null;
  let max: number | null = null;

  // 1) do status "with X of Y listeners"
  if (statusText) {
    const m =
      statusText.match(/with\s+(\d+)\s+of\s+(\d+)\s+listeners/i) ||
      statusText.match(/com\s+(\d+)\s+de\s+(\d+)\s+ouvintes/i);
    if (m) {
      current = parseInt(m[1], 10);
      max = parseInt(m[2], 10);
    }
  }

  // 2) campos específicos em HTML
  if (current == null) {
    const m =
      html.match(/Current\s*Listeners[^:]*:\s*<\/td>\s*<td[^>]*>\s*(\d+)/i) ||
      html.match(/Ouvintes\s*Atuais[^:]*:\s*<\/*
