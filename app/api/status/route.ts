// /app/api/radio/status/route.ts
import type { NextRequest } from "next/server";

const BASE = "http://sonicpanel.oficialserver.com:8342";
const STREAM_URL = `${BASE}/;`;
const CANDIDATES = [
  `${BASE}/index.html?sid=1`,
  `${BASE}/index.html`,
  `${BASE}/`,
];

const UA = "Mozilla/5.0 (StatusFetcher)";

const stripTags = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

const decodeHtml = (s: string) =>
  s.replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

function extractLabelValueHtml(html: string, labelRegex: string) {
  // Padrão 1: <td>Label:</td><td>valor</td>
  let re = new RegExp(
    `<td[^>]*>\\s*${labelRegex}\\s*:\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
    "i"
  );
  let m = html.match(re);
  if (m) return decodeHtml(stripTags(m[1]));

  // Padrão 2: "Label: valor<br>" (ou fecha a célula/linha)
  re = new RegExp(
    `${labelRegex}\\s*:\\s*([\\s\\S]*?)(?:<br[^>]*\\/?\\s*>|<\\/td>|<\\/tr>|<\\/p>|<hr|\\n)`,
    "i"
  );
  m = html.match(re);
  if (m) return decodeHtml(stripTags(m[1]));

  return null;
}

function extractListeners(html: string, statusText: string | null) {
  let current: number | null = null;
  let max: number | null = null;

  if (statusText) {
    // Ex.: "with 41 of 1000 listeners"
    let m = statusText.match(/with\s+(\d+)\s+of\s+(\d+)\s+listeners/i);
    if (!m) m = statusText.match(/com\s+(\d+)\s+de\s+(\d+)\s+ouvintes/i); // caso PT
    if (m) {
      current = parseInt(m[1], 10);
      max = parseInt(m[2], 10);
    }
  }
  if (current == null) {
    const m =
      html.match(/Current\s*Listeners[^:]*:\s*<\/td>\s*<td[^>]*>\s*(\d+)/i) ||
      html.match(/Ouvintes\s*Atuais[^:]*:\s*<\/td>\s*<td[^>]*>\s*(\d+)/i);
    if (m) current = parseInt(m[1], 10);
  }
  if (max == null) {
    const m =
      html.match(/Maximum\s*Listeners[^:]*:\s*<\/td>\s*<td[^>]*>\s*(\d+)/i) ||
      html.match(/Capacidade[^:]*:\s*<\/td>\s*<td[^>]*>\s*(\d+)/i);
    if (m) max = parseInt(m[1], 10);
  }
  return { current, max };
}

export async function GET(req: NextRequest) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  let lastErr: any = null;

  for (const candidate of CANDIDATES) {
    try {
      const res = await fetch(candidate, {
        headers: { "User-Agent": UA },
        cache: "no-store",
        redirect: "follow",
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status} em ${candidate}`;
        continue;
      }

      const html = await res.text();
      if (debug) {
        // Mostra o HTML bruto para inspecionar no navegador
        return new Response(html, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "access-control-allow-origin": "*",
          },
        });
      }

      const title =
        extractLabelValueHtml(html, "Stream\\s*Title") ||
        extractLabelValueHtml(html, "Stream\\s*Name");
      const genre = extractLabelValueHtml(html, "Stream\\s*Genre");
      const statusText = extractLabelValueHtml(html, "Stream\\s*Status");
      const currentSong =
        extractLabelValueHtml(html, "Current\\s*Song") ||
        extractLabelValueHtml(html, "M(ú|u)sica\\s*Atual");

      const { current, max } = extractListeners(html, statusText);

      const something =
        title ||
        genre ||
        statusText ||
        currentSong ||
        current != null ||
        max != null;

      if (!something) {
        lastErr = `Sem campos detectados em ${candidate}`;
        continue;
      }

      return new Response(
        JSON.stringify({
          ok: true,
          source: candidate,
          stream: {
            title,
            genre,
            statusText,
            listeners: { current, max },
            currentSong,
            url: STREAM_URL,
          },
          display: {
            locutor: title,
            programacao: genre,
            ouvintes: current,
            capacidade: max,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
          },
        }
      );
    } catch (e: any) {
      lastErr = e?.message || String(e);
      // tenta o próximo endpoint
    }
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error:
        "Não consegui extrair dados do HTML de status. Veja `detail` e teste o modo debug.",
      detail: lastErr,
      tried: CANDIDATES,
    }),
    {
      status: 502,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      },
    }
  );
}
