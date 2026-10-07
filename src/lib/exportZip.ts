// Uncompressed ZIP, streamed to a browser-selected file where supported. The fallback
// retains Blob parts (not the complete account object) and has an explicit size ceiling.
export type ExportSink = {
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export class ExportZip {
  private offset = 0;
  private entries: Uint8Array[] = [];
  private names = new Set<string>();
  private sink: ExportSink;
  constructor(sink: ExportSink) { this.sink = sink; }
  async add(name: string, bytes: Uint8Array) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.includes('..') || name.startsWith('/') || this.names.has(name)) throw new Error('Invalid export filename.');
    // ZIP32 is intentionally bounded; never produce an unreadable ZIP64-sized file.
    if (this.entries.length >= 60_000 || this.offset + bytes.length + 4096 > 2_000_000_000) throw new Error('This account exceeds the current export limit. Contact support for an assisted export.');
    const path = encoder.encode(name);
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + path.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true); view.setUint16(12, 33, true); // UTF-8, Jan 1 1980
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
    view.setUint16(26, path.length, true); header.set(path, 30);
    const central = new Uint8Array(46 + path.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true); c.setUint16(14, 33, true);
    c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true);
    c.setUint16(28, path.length, true); c.setUint32(42, this.offset, true); central.set(path, 46);
    await this.sink.write(header); await this.sink.write(bytes);
    this.offset += header.length + bytes.length;
    this.entries.push(central); this.names.add(name);
  }
  async finish() {
    const start = this.offset;
    for (const entry of this.entries) { await this.sink.write(entry); this.offset += entry.length; }
    const end = new Uint8Array(22); const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, this.entries.length, true); v.setUint16(10, this.entries.length, true);
    v.setUint32(12, this.offset - start, true); v.setUint32(16, start, true);
    await this.sink.write(end); await this.sink.close();
  }
}

export async function chooseExportSink(filename: string): Promise<ExportSink> {
  const browser = window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<ExportSink> }> };
  if (browser.showSaveFilePicker) {
    const file = await browser.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }] });
    return file.createWritable();
  }
  const parts: Blob[] = []; let size = 0;
  return {
    async write(bytes) {
      size += bytes.length;
      if (size > 256 * 1024 * 1024) throw new Error('This export is too large for this browser. Retry in desktop Chrome or Edge, which can save directly to a file. No complete export was downloaded.');
      parts.push(new Blob([bytes as BlobPart]));
    },
    async close() {
      const blob = new Blob(parts, { type: 'application/zip' }); parts.length = 0;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() { parts.length = 0; },
  };
}
