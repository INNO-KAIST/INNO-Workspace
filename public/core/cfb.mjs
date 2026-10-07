import { MAX_COMPRESSED_BYTES } from './extract-shared.mjs';

// Compound File Binary (CFB): the container of HWP 5.0 and of Word, Excel and PowerPoint
// 97-2003 files. Reads the FAT (with DIFAT), the mini stream and the directory tree; every
// chain, length and traversal is bounded so a damaged file fails instead of looping.
// compoundFile(bytes) returns { entries, children(id), named(parent, name, type), read(id) }.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const NO_STREAM = 0xffffffff;
export const STORAGE = 1, STREAM = 2, ROOT = 5;

export function compoundFile(bytes, { label = 'compound' } = {}) {
  const damaged = (detail) => new Error(`the ${label} file is damaged (${detail})`);
  if (bytes.length < 512 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) throw damaged('not a compound file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset) => view.getUint32(offset, true);
  const sectorShift = view.getUint16(0x1e, true);
  const miniShift = view.getUint16(0x20, true);
  if ((sectorShift !== 9 && sectorShift !== 12) || miniShift !== 6) throw damaged('unexpected sector size');
  const sectorSize = 1 << sectorShift, miniSize = 1 << miniShift;
  const sectorCount = Math.floor(bytes.length / sectorSize) - 1;
  const sectorOffset = (sector) => {
    if (sector >= sectorCount) throw damaged('sector outside the file');
    return (sector + 1) * sectorSize;
  };
  const perSector = sectorSize / 4;

  // FAT sector numbers: 109 in the header, the rest along the DIFAT chain.
  const fatSectors = [];
  for (let index = 0; index < 109 && fatSectors.length < u32(0x2c); index += 1) fatSectors.push(u32(0x4c + index * 4));
  let difat = u32(0x44);
  for (let count = 0; count < u32(0x48) && difat < END_OF_CHAIN; count += 1) {
    if (count > sectorCount) throw damaged('cyclic DIFAT chain');
    const offset = sectorOffset(difat);
    for (let index = 0; index < perSector - 1 && fatSectors.length < u32(0x2c); index += 1) fatSectors.push(u32(offset + index * 4));
    difat = u32(offset + (perSector - 1) * 4);
  }
  if (fatSectors.length > sectorCount) throw damaged('FAT larger than the file');
  const fat = new Uint32Array(fatSectors.length * perSector);
  fatSectors.forEach((sector, index) => {
    const offset = sectorOffset(sector);
    for (let entry = 0; entry < perSector; entry += 1) fat[index * perSector + entry] = u32(offset + entry * 4);
  });

  // A sector chain, followed no further than `needed` sectors (a stream reads only its own
  // length, however long a damaged chain runs); a repeated sector means a cycle.
  const chain = (start, table, limit, needed = Infinity) => {
    const sectors = [], seen = new Set();
    for (let sector = start; sector !== END_OF_CHAIN && sectors.length < needed; sector = table[sector]) {
      if (sector >= table.length || sectors.length >= limit) throw damaged('broken or cyclic sector chain');
      if (seen.has(sector)) throw damaged('cyclic sector chain');
      seen.add(sector);
      sectors.push(sector);
    }
    return sectors;
  };
  const readRegular = (start, size) => {
    if (size > bytes.length) throw damaged('stream larger than the file');
    const out = new Uint8Array(size);
    let written = 0;
    for (const sector of chain(start, fat, sectorCount, Math.ceil(size / sectorSize))) {
      if (written >= size) break;
      const offset = sectorOffset(sector);
      const piece = bytes.subarray(offset, offset + Math.min(sectorSize, size - written));
      out.set(piece, written);
      written += piece.length;
    }
    if (written < size) throw damaged('stream shorter than declared');
    return out;
  };
  const readAll = (start) => {
    const sectors = chain(start, fat, sectorCount);
    return readRegular(start, sectors.length * sectorSize);
  };

  const directoryBytes = readAll(u32(0x30));
  const directoryView = new DataView(directoryBytes.buffer);
  const entries = [];
  for (let base = 0; base + 128 <= directoryBytes.length; base += 128) {
    const nameLength = Math.min(directoryView.getUint16(base + 64, true), 64);
    let name = '';
    for (let offset = 0; offset + 2 < nameLength; offset += 2) name += String.fromCharCode(directoryView.getUint16(base + offset, true));
    entries.push({
      name,
      type: directoryBytes[base + 66],
      left: directoryView.getUint32(base + 68, true),
      right: directoryView.getUint32(base + 72, true),
      child: directoryView.getUint32(base + 76, true),
      start: directoryView.getUint32(base + 116, true),
      size: directoryView.getUint32(base + 120, true),
    });
  }
  const root = entries[0];
  if (!root || root.type !== ROOT) throw damaged('missing root entry');
  const cutoff = u32(0x38);
  let miniStream = null, miniFat = null;
  const readMini = (start, size) => {
    if (!miniStream) {
      miniStream = root.size ? readRegular(root.start, root.size) : new Uint8Array(0);
      const fatBytes = u32(0x3c) < END_OF_CHAIN ? readAll(u32(0x3c)) : new Uint8Array(0);
      miniFat = new Uint32Array(fatBytes.buffer, fatBytes.byteOffset, Math.floor(fatBytes.length / 4)).slice();
    }
    const out = new Uint8Array(size);
    let written = 0;
    for (const sector of chain(start, miniFat, Math.ceil(miniStream.length / miniSize), Math.ceil(size / miniSize))) {
      if (written >= size) break;
      const piece = miniStream.subarray(sector * miniSize, sector * miniSize + Math.min(miniSize, size - written));
      out.set(piece, written);
      written += piece.length;
    }
    if (written < size) throw damaged('stream shorter than declared');
    return out;
  };

  const children = (index) => {
    const found = [], seen = new Set(), stack = [entries[index]?.child];
    while (stack.length) {
      const id = stack.pop();
      if (id === undefined || id === NO_STREAM || id >= entries.length) continue;
      if (seen.has(id)) throw damaged('cyclic directory');
      seen.add(id);
      found.push(id);
      stack.push(entries[id].left, entries[id].right);
    }
    return found;
  };
  const named = (parent, name, type) => children(parent).find((id) => entries[id].type === type && entries[id].name.toLowerCase() === name.toLowerCase());
  const read = (id) => {
    const entry = entries[id];
    if (entry.size > MAX_COMPRESSED_BYTES) throw damaged('stream too large');
    return entry.size < cutoff ? readMini(entry.start, entry.size) : readRegular(entry.start, entry.size);
  };
  return { entries, children, named, read };
}

export const isCompoundFile = (bytes) => bytes.length >= 512 && SIGNATURE.every((byte, index) => bytes[index] === byte);
