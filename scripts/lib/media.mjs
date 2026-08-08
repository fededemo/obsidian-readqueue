/**
 * Descarga de las imágenes de X a la vault.
 *
 * Las notas de X guardaban solo el `type` de cada media y tiraban la URL, así
 * que 277 de 519 quedaron sin sus imágenes. Ahora se bajan: el CDN de X sirve
 * `pbs.twimg.com` sin auth, pero linkear ahí ata el archivo personal a que X
 * siga sirviéndolo — y no funciona sin conexión, que es justo cuando uno lee.
 *
 * Lo usan tanto `sync-x.mts` (lo nuevo) como `backfill-x-media.mts` (lo viejo).
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const UA = "obsidian-readqueue/1.0 (personal archive)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Baja `url` a `dest` si no está ya. Devuelve "ok" | "cached" | "failed".
 *
 * Nunca tira: una imagen que no se pudo bajar cae al link remoto en la nota, y
 * eso no debe abortar un sync de cientos de items.
 */
export async function downloadAsset(url, dest, { retries = 2 } = {}) {
  // Un archivo de 0 bytes es una descarga cortada, no un asset: re-intentarlo.
  if (existsSync(dest) && statSync(dest).size > 0) return "cached";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      if (!res.ok) return "failed";
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) return "failed";
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      return "ok";
    } catch {
      await sleep(700 * (attempt + 1));
    }
  }
  return "failed";
}

/**
 * Baja una lista de assets con concurrencia acotada.
 *
 * Devuelve un Set con los `filename` que quedaron disponibles en disco — es
 * exactamente lo que necesita el `MediaResolver` para decidir entre embeber
 * local o caer al remoto.
 */
export async function downloadAll(assets, mediaDir, { concurrency = 4, onProgress } = {}) {
  const available = new Set();
  const stats = { ok: 0, cached: 0, failed: 0 };
  const queue = [...assets];

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const asset = queue.shift();
        if (!asset) break;
        const result = await downloadAsset(asset.url, join(mediaDir, asset.filename));
        stats[result]++;
        if (result !== "failed") available.add(asset.filename);
        onProgress?.(stats);
      }
    }),
  );

  return { available, stats };
}
