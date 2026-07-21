import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger/index.js';

export function sanitizeFileName(name) {
  name = (name ?? '').trim();
  name = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
  if (name.length > 255) {
    const dot = name.lastIndexOf('.');
    if (dot > 0 && name.length - dot <= 10) {
      // Preserve extension up to 10 chars when possible
      const ext = name.slice(dot);
      name = name.slice(0, 255 - ext.length) + ext;
    } else {
      name = name.slice(0, 255);
    }
  }
  return name || 'unnamed';
}

export function fmtSize(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(2)} ${units[i]}`;
}

export async function saveMedia(client, msg, savePath, onDone, expectedSize = 0) {
  const dl = savePath + '.dl';

  if (fs.existsSync(savePath)) {
    const have = fs.statSync(savePath).size;
    if (expectedSize === 0 || have >= expectedSize) {
      log.debug('file complete, skip', { savePath, have, expected: expectedSize });
      onDone?.(null, savePath);
      return;
    }
  }

  fs.mkdirSync(path.dirname(savePath), { recursive: true });

  let progressTick = 0;
  try {
    const result = await client.downloadMedia(msg, {
      outputFile: dl,
      progressCallback: (received, total) => {
        if (++progressTick % 32 === 0) {
          log.debug('dl progress', { savePath, received, total });
        }
      },
    });
    // Three outcomes:
    //   1. downloadMedia wrote to outputFile → rename .dl → final
    //   2. downloadMedia returned a Buffer (no file written) → write it now
    //   3. downloadMedia wrote nothing (truly empty / degenerate) → error
    if (fs.existsSync(dl)) {
      fs.renameSync(dl, savePath);
    } else if (Buffer.isBuffer(result) && result.length > 0) {
      fs.writeFileSync(savePath, result);
    } else {
      throw new Error('download returned no data');
    }
    log.info('download ok', { savePath });
    onDone?.(null, savePath);
  } catch (e) {
    log.warn(e, 'download fail', { savePath });
    onDone?.(e, savePath);
  }
}