// /app/api/radio/status/route.ts
import type { NextRequest } from "next/server";

const BASE = "http://sonicpanel.oficialserver.com:8342";
const STREAM_URL = `${BASE}/;`; // para o <audio>

// tenta várias rotas conhecidas do Shoutcast v1/v2
const CANDIDATES = [
  `${BASE}/index.html?sid=1`,
  `${BASE}/index.html`,
  `${BASE}/`,
  `${BASE}/stats?sid=1`,       // v2 (XML)
  `${BASE}/stats`,             // v2 (XML)
  `${BASE}/7.html`,            // v1 (csv)
];

async function tryFetch(url: string) {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 ShoutcastStatusFetcher" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  const text = await r.text();
  return { url, text };
}

// --------- Parsers ---------

function parseFromHtml(html: string) {
  // pega célula da tabela: "Label:</td><td>valor"
  const cell = (label: string) => {
    const re = new RegExp(
      `${label}\\s*:\\s*<\\/td>\\s*<td[^>]*>\\s*([^<]+)`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };

  const streamStatus = cell("Stream\\s+Status");
  const streamTitle  = cell("Stream\\s+Title");
  const streamGenre  = cell("Stream\\s+Genre");
  const currentSong  = cell("Current\\s+Song");
  const contentType  = cell("Content\\s+Type");

  // listeners a partir do status "with X of Y listeners"
  let current: number | null = null;
  let max: number | null = null;
  if (streamStatus) {
    const m = streamStatus.match(/with\s+(\d+)\s+of\s+(\d+)\s+listeners/i);
    if (m) {
      current = parseInt(m[1], 10);
      max = parseInt(m[2], 10);
    }
  }

  // fallback: às vezes aparece "Current Listeners:" em outra linha
  if (current === null) {
    const m = html.match(/Current\s*Listeners[^:]*:\s*<\/td>\s*<td[^>]*>\s*(\d+)/i);
    if (m) current = parseInt(m[1], 10);
  }
  if (max === null) {
    const m = html.match(/Maximum\s*Listeners[^:]*:\s*<\/td>\s*<td[^>]*>\s*(\d+)/i);
    if (m) max = parseInt(m[1], 10);
  }

  const ok = streamTitle || streamGenre || streamStatus || currentSong;
  if (!ok) return null;

  return {
    title: streamTitle,
    genre: streamGenre,
    statusText: streamStatus,
    listeners: { current, max },
    contentType,
    currentSong,
  };
}

function parseFromXml(xml: string) {
  // Shoutcast v2 XML: <STREAMTITLE>, <GENRE>, <CURRENTLISTENERS>, <MAXLISTENERS>, <SONGTITLE>
  const tag = (t: string) => {
    const m = xml.match(new RegExp(`<${t}>([^<]*)</${t}>`, "i"));
    return m ? m[1].trim() : null;
  };
  const title = tag("STREAMTITLE") || tag("SERVERTITLE");
  const genre = tag("GENRE");
  const current = tag("CURRENTLISTENERS");
  const max = tag("MAXLISTENERS");
  const song = tag("SONGTITLE") || tag("CURRENTSONG");

  // às vezes aparece um status inteiro: <STREAMSTATUS>1</STREAMSTATUS> e <BITRATE>...</BITRATE>
  const statusRaw = tag("STREAMSTATUS");
  const bitrate = tag("BITRATE");
  const statusText =
    statusRaw && bitrate
      ? `Stream is ${statusRaw === "1" ? "up" : "down"} at ${bitrate} kbps`
      : null;

  const ok = title || genre || current || max || song;
  if (!ok) return null;

  return {
    title,
    genre,
    statusText,
    listeners: {
      current: current ? parseInt(current, 10) : null,
      max: max ? parseInt(max, 10) : null,
    },
    contentType: null,
    currentSong: song,
  };
}

function parseFromCsv(csv: string) {
  // /7.html (v1) retorna algo como: "OK2, listeners, max, ?, bitrate, current song"
  // ou "OK,xx,yy,zz,bitrate,song"
  if (!/^OK/i.test(csv)) return null;
  // limpa tags se vier embrulhado em <html>
  const text = csv.replace(/<[^>]+>/g, "").trim();
  const parts = text.split(",").map((s) => s.trim());
  if (parts.length < 6) return null;
  const current = parseInt(parts[1], 10);
  const max = parseInt(parts[2], 10);
  const song = parts.slice(5).join(", "); // pois o título pode ter vírgulas
  return {
    title: null,
    genre: null,
    statusText: `with ${isNaN(current) ? "0" : current} of ${isNaN(max) ? "?" : max} listeners`,
    listeners: {
      current: isNaN(current) ? null : current,
      max: isNaN(max) ? null : max,
    },
    contentType: null,
    currentSong: song || null,
  };
}

// --------- Handler ---------

export async function GET(_req: NextRequest) {
  let lastErr: any = null;
  for (const url of CANDIDATES) {
    try {
      const { text } = await tryFetch(url);

      // 1) Tenta XML (stats)
      if (/<SHOUTCASTSERVER>|<STREAMTITLE>|<CURRENTLISTENERS>/i.test(text)) {
        const parsed = parseFromXml(text);
        if (parsed) return respond(url, parsed);
      }

      // 2) Tenta HTML “tabelado” do painel
      if (/Current\s*Stream\s*Information/i.test(text) || /Stream\s*Status/i.test(text)) {
        const parsed = parseFromHtml(text);
        if (parsed) return respond(url, parsed);
      }

      // 3) Tenta CSV do /7.html
      if (/^OK/i.test(text) || /OK,/.test(text)) {
        const parsed = parseFromCsv(text);
        if (parsed) return respond(url, parsed);
      }
    } catch (e: any) {
      lastErr = e;
      // tenta o próximo endpoint
    }
  }

  // se chegou aqui, nada funcionou
  return new Response(
    JSON.stringify({
      ok: false,
      error:
        "Não consegui extrair as informações do Shoutcast (nenhum endpoint conhecidamente suportado retornou dados parseáveis).",
      detail: lastErr?.message ?? null,
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

function respond(sourceUrl: string, parsed: any) {
  const payload = {
    ok: true,
    source: sourceUrl,
    stream: {
      ...parsed,
      url: STREAM_URL,
    },
    display: {
      locutor: parsed.title,
      programacao: parsed.genre,
      ouvintes: parsed.listeners?.current ?? null,
      capacidade: parsed.listeners?.max ?? null,
    },
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
