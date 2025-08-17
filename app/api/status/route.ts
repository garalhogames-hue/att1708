import { NextResponse } from "next/server"

export async function GET() {
  try {
    // Busca a página principal do Shoutcast que contém as informações
    const response = await fetch("http://sonicpanel.oficialserver.com:8342/", {
      headers: {
        "User-Agent": "RadioHabblive-Player/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      // Adiciona timeout para evitar travamentos
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      throw new Error("Failed to fetch radio status")
    }

    const html = await response.text()

    // Função para extrair dados do HTML
    const extractData = (html: string, label: string): string => {
      // Procura pelo padrão "Label: valor" ou "Label:</td><td>valor"
      const patterns = [
        new RegExp(`${label}:?\\s*</td>\\s*<td[^>]*>([^<]+)`, 'i'),
        new RegExp(`${label}:?\\s*([^<\\n]+)`, 'i'),
        new RegExp(`<b>${label}:?</b>\\s*([^<\\n]+)`, 'i')
      ]
      
      for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match && match[1]) {
          return match[1].trim()
        }
      }
      return ''
    }

    // Extrai as informações da página
    const streamTitle = extractData(html, 'Stream Title')
    const streamGenre = extractData(html, 'Stream Genre')
    const currentSong = extractData(html, 'Current Song')
    
    // Extrai o número de ouvintes do Stream Status
    let listeners = 0
    const statusMatch = html.match(/Stream is up at \d+ kbps with (\d+) of \d+ listeners/i) ||
                       html.match(/with (\d+) of \d+ listeners/i) ||
                       html.match(/(\d+)\s*(?:of\s*\d+)?\s*listeners?/i)
    
    if (statusMatch && statusMatch[1]) {
      listeners = parseInt(statusMatch[1]) || 0
    } else {
      // Tenta extrair de "Listener Peak:"
      const peakMatch = html.match(/Listener Peak:?\s*(\d+)/i)
      if (peakMatch && peakMatch[1]) {
        listeners = parseInt(peakMatch[1]) || 0
      }
    }

    // Extrai informações adicionais
    const bitrateMatch = html.match(/(\d+)\s*kbps/i)
    const bitrate = bitrateMatch ? parseInt(bitrateMatch[1]) : null

    // Verifica se está online baseado no conteúdo
    const isOnline = html.toLowerCase().includes('server is currently up') || 
                    html.toLowerCase().includes('stream is up') ||
                    listeners > 0

    const formattedData = {
      // Nome do locutor vem do Stream Title
      locutor: streamTitle || "Radio Habblive",
      
      // Programação vem do Stream Genre
      programa: streamGenre || "Tocando as Melhores",
      
      // Música atual vem do Current Song
      musica: currentSong || "Música não identificada",
      
      // Número de ouvintes
      unicos: listeners,
      
      // Informações extras
      bitrate: bitrate,
      status: isOnline ? 'online' : 'offline',
    }

    return NextResponse.json(formattedData, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type",
        // Cache por 10 segundos
        "Cache-Control": "public, max-age=10",
      },
    })
  } catch (error) {
    console.error("Error fetching shoutcast status:", error)

    // Tenta fallback com o endpoint 7.html (formato legado)
    try {
      const fallbackResponse = await fetch("http://sonicpanel.oficialserver.com:8342/7.html", {
        headers: {
          "User-Agent": "RadioHabblive-Player/1.0",
        },
        signal: AbortSignal.timeout(5000),
      })

      if (fallbackResponse.ok) {
        const text = await fallbackResponse.text()
        
        // Parse do formato 7.html (CSV)
        // Formato: listeners,status,peak,max,unique,bitrate,songtitle
        const parts = text.split(',')
        
        if (parts.length >= 7) {
          // Remove tags HTML do songtitle se houver
          const songTitle = parts[6] ? parts[6].replace(/<.*?>/g, '').trim() : 'Música não identificada';
          
          return NextResponse.json(
            {
              locutor: "Radio Habblive", // 7.html não fornece nome do DJ
              programa: "Tocando as Melhores", // 7.html não fornece programação
              musica: songTitle, // Música atual
              unicos: parseInt(parts[4]) || parseInt(parts[0]) || 0, // unique ou listeners
              bitrate: parseInt(parts[5]) || null,
              status: parts[1] === '1' ? 'online' : 'offline',
            },
            {
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "Content-Type",
              },
            }
          )
        }
      }
    } catch (fallbackError) {
      console.error("Fallback também falhou:", fallbackError)
    }

    // Return fallback data se tudo falhar
    return NextResponse.json(
      {
        locutor: "Radio Habblive",
        programa: "Tocando as Melhores",
        musica: "Música não identificada",
        unicos: 0,
        bitrate: null,
        status: "offline",
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      },
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}