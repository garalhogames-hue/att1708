// /app/api/radio/status/route.ts  (ou onde você já usa esse endpoint)
import type { NextRequest } from "next/server";

const STATUS_URL = "http://sonicpanel.oficialserver.com:8342/"; // página de status do Shoutcast
const STREAM_URL = "http://sonicpanel.oficialserver.com:8342/;"; // url do stream para o <audio>

function stripHtml(html: string) {
  return html
    // quebra linhas para <br> e <p> pra facilitar “varrer” o texto
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "") // remove tags
    .replace(/\u00a0/g, " ") // nbsp
    .replace(/[ \t]+/g, " ") // espaços repetidos
    .replace(/\n{2,}/g, "\n") // quebras repetidas
    .trim();
}

function pickLabeled(lines: string[], label: string) {
  // procura linhas do tipo: "Stream Title: Michael"
  const idx = lines.findIndex((l) =>
    l.toLowerCase().startsWith(label.toLowerCase() + ":")
  );
  if (idx === -1) return null;
  return lines[idx].split(":").slice(1).join(":").trim() || null;
}

function parseListenersFromStatus(statusText: string | null) {
  // exemplo de status:
  // "Stream is up at 128 kbps with 41 of 1000 listeners (1 unique)"
  if (!statusText) return { current: null as number | null, max: null as number | null };
  const m = statusText.match(/with\s+(\d+)\s+of\s+(\d+)\s+listeners/i);
  if (m) {
    return { current: parseInt(m[1], 10), max: parseInt(m[2], 10) };
  }
  return { current: null as number | null, max: null as number | null };
}

export async function GET(_req: NextRequest) {
  try {
    const res = await fetch(STATUS_URL, {
      // user-agent ajuda alguns painéis a devolver o HTML “completo”
      headers: { "User-Agent": "Mozilla/5.0 (StatusFetcher)" },
      cache: "no-store",
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: `Status HTTP ${res.status}` }),
        {
          status: 502,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
          },
        }
      );
    }

    const html = await res.text();
    const text = stripHtml(html);
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    const serverStatus = pickLabeled(lines, "Server Status"); // opcional
    const streamStatus = pickLabeled(lines, "Stream Status");
    const streamTitle = pickLabeled(lines, "Stream Title");   // locutor / AutoDJ
    const streamGenre = pickLabeled(lines, "Stream Genre");   // programação
    const contentType = pickLabeled(lines, "Content Type") ?? null;
    const currentSong = pickLabeled(lines, "Current Song") ?? null;

    const listeners = parseListenersFromStatus(streamStatus);

    const payload = {
      ok: true,
      source: STATUS_URL,
      serverStatus,
      stream: {
        title: streamTitle,     // NOME DO LOCUTOR (ou AutoDJ)
        genre: streamGenre,     // PROGRAMAÇÃO
        statusText: streamStatus,
        listeners,              // { current, max } — mostra mesmo no AutoDJ
        contentType,
        currentSong,
        url: STREAM_URL,
      },
      // útil para front-ends
      display: {
        locutor: streamTitle,
        programacao: streamGenre,
        ouvintes: listeners.current,
        capacidade: listeners.max,
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
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err?.message ?? "Erro desconhecido" }),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      }
    );
  }
}
