import { inflateSync } from "node:zlib";
import { PDFArray, PDFName, PDFParser, PDFRawStream, PDFRef } from "pdf-lib";
import { DomainError } from "../errors.ts";

const INFLATED_BYTES_BUDGET = 64 * 1024 * 1024;
const GAP = "(?:[\\x00\\t\\n\\f\\r ]|%[^\\r\\n]*(?:\\r\\n?|\\n))+";

// parseObject reads raw stream boundaries; parseDocument would already expand object/xref streams.
class RawStreamScanner extends PDFParser {
  scan(input: Uint8Array): PDFRawStream[] {
    const text = Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString("latin1");
    const headers = new RegExp(`(?<!\\d)\\d+${GAP}\\d+(?:${GAP})?obj`, "gu");
    const streams: PDFRawStream[] = [];
    while (headers.exec(text) !== null) {
      this.bytes.moveTo(headers.lastIndex);
      const object = this.parseObject();
      if (this.bytes.offset() <= headers.lastIndex) throw new Error("Invalid object boundary");
      // Do not skip raw candidates: pdf-lib's recovery can interpret headers in malformed data.
      if (object instanceof PDFRawStream) streams.push(object);
    }
    return streams;
  }
}

function requiresInflation(stream: PDFRawStream): boolean {
  const type = stream.dict.get(PDFName.of("Type"));
  const metadata = type === PDFName.of("ObjStm") || type === PDFName.of("XRef");
  const filter = stream.dict.get(PDFName.of("Filter"));
  if (!filter) return false;
  if (type instanceof PDFRef || filter instanceof PDFRef)
    throw new Error("Indirect stream encodings are unsupported");
  const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
  if (filters.some((encoding) => !(encoding instanceof PDFName)))
    throw new Error("Invalid stream encoding");
  if (filters.includes(PDFName.of("FlateDecode"))) {
    if (filters.length !== 1) throw new Error("Chained stream encodings are unsupported");
    return true;
  }
  // Other expanding decoders must not bypass the bound on streams pdf-lib expands during load.
  if (metadata) throw new Error("Unsupported metadata stream encoding");
  return false;
}

export function assertInflationBound(bytes: Uint8Array): void {
  try {
    const streams = new RawStreamScanner(bytes).scan(bytes);
    let remaining = INFLATED_BYTES_BUDGET;
    for (const stream of streams) {
      if (!requiresInflation(stream)) continue;
      const inflated = inflateSync(stream.contents, { maxOutputLength: Math.max(1, remaining) });
      remaining -= inflated.byteLength;
      if (remaining < 0) throw new Error("Inflation budget exhausted");
    }
  } catch {
    throw new DomainError("invalid", "The PDF has invalid or excessive compressed streams.");
  }
}
