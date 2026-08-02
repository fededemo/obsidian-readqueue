/**
 * Texto completo de un tweet vía FxTwitter.
 *
 * La API de X corta en 280 caracteres y engancha un `t.co`; el texto largo viaja
 * en otro campo que birdclaw no guarda. FxTwitter sí devuelve el post entero, es
 * pública y gratis — el intake ya la usa para el mismo problema.
 *
 * Medido sobre la vault: 293 caracteres guardados contra 3.247 reales. Sin esto
 * estábamos archivando el 9% de los posts largos.
 */

const ENDPOINT = "https://api.fxtwitter.com/status";

/** Devuelve el texto completo, o undefined si no se pudo. Nunca tira. */
export async function fetchFullText(tweetId, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}/${tweetId}`, {
        headers: { "user-agent": "obsidian-readqueue/1.0 (personal archive)" },
      });
      if (res.status === 429 || res.status >= 500) {
        // Backoff: es un servicio público y gratuito, no hay que castigarlo.
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) return undefined;
      const json = await res.json();
      const text = json?.tweet?.text;
      return typeof text === "string" && text.length > 0 ? text : undefined;
    } catch {
      await sleep(800 * (attempt + 1));
    }
  }
  return undefined;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** El id del tweet a partir de la URL que guarda la nota. */
export function tweetIdFromUrl(url) {
  return /(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i.exec(url ?? "")?.[1];
}
