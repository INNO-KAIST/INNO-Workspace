// Test helper: a minimal Compound File Binary writer (the container of HWP 5.0 and of
// Office 97-2003 files) for building fixtures in tests.
export const END = 0xfffffffe, FREE = 0xffffffff, FATSECT = 0xfffffffd, DIFSECT = 0xfffffffc, NONE = 0xffffffff;
export const SECTOR = 512, MINI = 64, CUTOFF = 4096, PER_SECTOR = SECTOR / 4;

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
export function u32s(values) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return out;
}

// A minimal compound file writer: small streams go to the mini stream, large ones to sectors.
// An entry may share another entry's stream (sameAs: its index in `entries`), and `filler`
// sectors make the FAT outgrow the 109 header slots so a DIFAT sector is written.
export function compoundFile(entries, { filler = 0 } = {}) {
  const nodes = [{ name: 'Root Entry', type: 5, children: [] }, ...entries.map((entry) => ({ ...entry, type: entry.data || entry.sameAs !== undefined ? 2 : 1, children: [] }))];
  entries.forEach((entry, index) => nodes[entry.parent ?? 0].children.push(index + 1));
  const sectors = [], fat = [];
  const place = (bytes) => {
    const start = fat.length, count = Math.max(1, Math.ceil(bytes.length / SECTOR));
    for (let index = 0; index < count; index += 1) {
      fat.push(index === count - 1 ? END : start + index + 1);
      const sector = new Uint8Array(SECTOR);
      sector.set(bytes.subarray(index * SECTOR, (index + 1) * SECTOR));
      sectors.push(sector);
    }
    return start;
  };
  const own = nodes.filter((node) => node.type === 2 && node.data);
  const mini = [], miniFat = [];
  for (const node of own) {
    if (node.data.length >= CUTOFF) continue;
    node.start = miniFat.length;
    const count = Math.max(1, Math.ceil(node.data.length / MINI));
    for (let index = 0; index < count; index += 1) miniFat.push(index === count - 1 ? END : node.start + index + 1);
    const padded = new Uint8Array(count * MINI);
    padded.set(node.data);
    mini.push(padded);
  }
  for (const node of own) if (node.data.length >= CUTOFF) node.start = place(node.data);
  for (const node of nodes) if (node.sameAs !== undefined) { node.start = nodes[node.sameAs + 1].start; node.data = nodes[node.sameAs + 1].data; }
  if (filler) place(new Uint8Array(filler * SECTOR));
  const miniStream = concat(mini);
  nodes[0].start = miniStream.length ? place(miniStream) : END;
  nodes[0].data = { length: miniStream.length };
  while (miniFat.length % PER_SECTOR) miniFat.push(FREE);
  const miniFatStart = miniFat.length ? place(u32s(miniFat)) : END;
  const directory = new Uint8Array(Math.ceil(nodes.length / 4) * 4 * 128);
  const view = new DataView(directory.buffer);
  for (let index = 0; index < directory.length / 128; index += 1) {
    const base = index * 128;
    view.setUint32(base + 68, NONE, true); view.setUint32(base + 72, NONE, true); view.setUint32(base + 76, NONE, true);
    const node = nodes[index];
    if (!node) continue;
    for (let char = 0; char < node.name.length; char += 1) view.setUint16(base + char * 2, node.name.charCodeAt(char), true);
    view.setUint16(base + 64, (node.name.length + 1) * 2, true);
    directory[base + 66] = node.type;
    directory[base + 67] = 1;
    if (node.children.length) view.setUint32(base + 76, node.children[0], true);
    view.setUint32(base + 116, node.type === 1 ? 0 : node.start, true);
    view.setUint32(base + 120, node.type === 1 ? 0 : node.data.length, true);
  }
  for (const node of nodes) node.children.forEach((child, index) => { if (index + 1 < node.children.length) view.setUint32(child * 128 + 72, node.children[index + 1], true); });
  const directoryStart = place(directory);
  let fatCount = 1, difatCount = 0;
  for (;;) {
    const needFat = Math.ceil((fat.length + fatCount + difatCount) / PER_SECTOR);
    const needDifat = needFat > 109 ? Math.ceil((needFat - 109) / (PER_SECTOR - 1)) : 0;
    if (needFat === fatCount && needDifat === difatCount) break;
    fatCount = needFat; difatCount = needDifat;
  }
  const fatSectors = Array.from({ length: fatCount }, (_, index) => fat.length + index);
  for (let index = 0; index < fatCount; index += 1) fat.push(FATSECT);
  const difatStart = fat.length;
  for (let index = 0; index < difatCount; index += 1) fat.push(DIFSECT);
  while (fat.length % PER_SECTOR) fat.push(FREE);
  const difat = [];
  for (let index = 0; index < difatCount; index += 1) {
    const slots = fatSectors.slice(109 + index * (PER_SECTOR - 1), 109 + (index + 1) * (PER_SECTOR - 1));
    while (slots.length < PER_SECTOR - 1) slots.push(FREE);
    difat.push(u32s([...slots, index + 1 < difatCount ? difatStart + index + 1 : END]));
  }
  const header = new Uint8Array(SECTOR);
  const headerView = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  headerView.setUint16(0x18, 0x3e, true); headerView.setUint16(0x1a, 3, true); headerView.setUint16(0x1c, 0xfffe, true);
  headerView.setUint16(0x1e, 9, true); headerView.setUint16(0x20, 6, true);
  headerView.setUint32(0x2c, fatCount, true); headerView.setUint32(0x30, directoryStart, true);
  headerView.setUint32(0x38, CUTOFF, true); headerView.setUint32(0x3c, miniFatStart, true);
  headerView.setUint32(0x40, miniFat.length ? miniFat.length / PER_SECTOR : 0, true);
  headerView.setUint32(0x44, difatCount ? difatStart : END, true); headerView.setUint32(0x48, difatCount, true);
  for (let index = 0; index < 109; index += 1) headerView.setUint32(0x4c + index * 4, index < fatCount ? fatSectors[index] : FREE, true);
  return concat([header, ...sectors, u32s(fat), ...difat]);
}
