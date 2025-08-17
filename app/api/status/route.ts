export default async function handler(req, res) {
  const BASE = 'http://sonicpanel.oficialserver.com:8342';

  // helper pra consertar "VocÃª" -> "Você"
  const fixAcentos = (s) => {
    try { return decodeURIComponent(escape(s)); } catch { return s; }
  };

  // lê 7.html
  let seven;
  try {
    const r = await fetch(`${BASE}/7.html`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    let raw = await r.text();
    // remove tags HTML que alguns servidores colocam
    raw = raw.replace(/<[^>]*>/g, '').trim();

    // pega a linha CSV (v1)
    const line = raw.split(/\r?\n/).find(l => l.split(',').length >= 7) || raw;
    const parts = line.split(',');

    const [cur, status, peak, max, unique, br, ...titleParts] = parts;
    seven = {
      currentlisteners: Number(cur),
      streamstatus: Number(status),
      peaklisteners: Number(peak),
      maxlisteners: Number(max),
      uniquelisteners: Number(unique),
      bitrate: Number(br),
      songtitle: fixAcentos(titleParts.join(',').trim())
    };
  } catch (e) {
    res.status(502).json({ error: 'Falha ao ler 7.html', details: String(e) });
    return;
  }

  // (Opcional) Raspa a página de status pra pegar "Stream Title" e "Stream Genre"
  let streamTitle = null, streamGenre = null;
  try {
    const r = await fetch(`${BASE}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const findCell = (label) => {
      const re = new RegExp(`${label}\\s*:?\\s*</?[^>]*>\\s*([^<]+)`, 'i');
      const m = html.replace(/\n/g, ' ').match(re);
      return m ? m[1].trim() : null;
    };
    streamTitle = findCell('Stream Title') || findCell('Server Title');
    streamGenre  = findCell('Stream Genre')  || findCell('Server Genre');
    if (streamTitle) streamTitle = fixAcentos(streamTitle);
    if (streamGenre) streamGenre = fixAcentos(streamGenre);
  } catch (_) { /* ok se falhar */ }

  // “Nome do locutor”: em v1 geralmente vem no Stream Title quando há DJ
  const nomeLocutor = streamTitle || null;

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    online: seven.streamstatus === 1,
    ouvintes: seven.currentlisteners,
    maxOuvintes: seven.maxlisteners || null,
    pico: seven.peaklisteners || null,
    unicos: seven.uniquelisteners || null,
    bitrate: seven.bitrate || null,
    musica: seven.songtitle || null,
    programacao: streamGenre || null,
    nomeLocutor,
    fonte: 'v1-7.html'
  });
}
