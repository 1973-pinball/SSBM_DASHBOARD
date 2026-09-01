import { Decompress } from "fzstd";

export const SLPZ_VERSION = 0;
export const MAX_DECOMPRESSED_EVENTS_BYTES = 256 * 1024 * 1024;

const SLPZ_HEADER_BYTES = 24;
const EVENT_PAYLOADS = 0x35;
const GAME_START = 0x36;
const UINT32_MAX = 0xffff_ffff;
const ZSTD_MAGIC = 0xfd2f_b528;

const RAW_HEADER = new Uint8Array([
  0x7b, 0x55, 0x03, 0x72, 0x61, 0x77, 0x5b, 0x24, 0x55, 0x23, 0x6c,
]);

export type SlpzDecodeErrorCode =
  | "invalid-header"
  | "unsupported-version"
  | "invalid-sections"
  | "invalid-event-sizes"
  | "invalid-game-start"
  | "size-limit"
  | "decompression-failed"
  | "decompressed-size-mismatch"
  | "invalid-events";

export class SlpzDecodeError extends Error {
  readonly code: SlpzDecodeErrorCode;

  constructor(code: SlpzDecodeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SlpzDecodeError";
    this.code = code;
  }
}

export class SlpzUnsupportedVersionError extends SlpzDecodeError {
  readonly version: number;

  constructor(version: number) {
    super(
      "unsupported-version",
      `Unsupported .slpz version ${version}; this app supports version ${SLPZ_VERSION}.`,
    );
    this.name = "SlpzUnsupportedVersionError";
    this.version = version;
  }
}

export class SlpzSizeLimitError extends SlpzDecodeError {
  readonly declaredBytes: number;
  readonly limitBytes: number;

  constructor(declaredBytes: number, limitBytes = MAX_DECOMPRESSED_EVENTS_BYTES) {
    super(
      "size-limit",
      `.slpz event data expands to ${declaredBytes} bytes, above the ${limitBytes}-byte safety limit.`,
    );
    this.name = "SlpzSizeLimitError";
    this.declaredBytes = declaredBytes;
    this.limitBytes = limitBytes;
  }
}

export function isSlpzPath(path: string): boolean {
  return path.toLowerCase().endsWith(".slpz");
}

/** Decode an official version-0 .slpz file into ordinary .slp bytes. */
export function decodeSlpz(input: Uint8Array): Uint8Array<ArrayBuffer> {
  if (input.byteLength < SLPZ_HEADER_BYTES) {
    throw new SlpzDecodeError(
      "invalid-header",
      `.slpz header is truncated (expected ${SLPZ_HEADER_BYTES} bytes).`,
    );
  }

  const header = new DataView(input.buffer, input.byteOffset, SLPZ_HEADER_BYTES);
  const version = header.getUint32(0, false);
  if (version !== SLPZ_VERSION) throw new SlpzUnsupportedVersionError(version);

  const eventSizesOffset = header.getUint32(4, false);
  const gameStartOffset = header.getUint32(8, false);
  const metadataOffset = header.getUint32(12, false);
  const compressedEventsOffset = header.getUint32(16, false);
  const decompressedEventsSize = header.getUint32(20, false);

  validateSectionOffsets(
    input.byteLength,
    eventSizesOffset,
    gameStartOffset,
    metadataOffset,
    compressedEventsOffset,
  );
  if (decompressedEventsSize > MAX_DECOMPRESSED_EVENTS_BYTES) {
    throw new SlpzSizeLimitError(decompressedEventsSize);
  }

  const eventSizesSection = input.subarray(eventSizesOffset, gameStartOffset);
  const gameStartSection = input.subarray(gameStartOffset, metadataOffset);
  const metadataSection = input.subarray(metadataOffset, compressedEventsOffset);
  const compressedEvents = input.subarray(compressedEventsOffset);
  const eventSizes = parseEventSizes(eventSizesSection);
  validateGameStart(gameStartSection, eventSizes);

  validateSingleZstdFrame(compressedEvents, decompressedEventsSize);
  const reorderedEvents = decompressExact(compressedEvents, decompressedEventsSize);
  const eventLayout = validateReorderedEvents(reorderedEvents, eventSizes);

  const rawLength =
    eventSizesSection.byteLength +
    gameStartSection.byteLength +
    eventLayout.unorderedBytes;
  if (rawLength > UINT32_MAX) {
    throw new SlpzSizeLimitError(rawLength, UINT32_MAX);
  }

  const outputLength = 15 + rawLength + metadataSection.byteLength;
  const output = allocate(outputLength);
  output.set(RAW_HEADER, 0);
  new DataView(output.buffer).setUint32(11, rawLength, false);

  let outputOffset = 15;
  output.set(eventSizesSection, outputOffset);
  outputOffset += eventSizesSection.byteLength;
  output.set(gameStartSection, outputOffset);
  outputOffset += gameStartSection.byteLength;
  unorderEventsInto(reorderedEvents, eventSizes, eventLayout, output, outputOffset);
  outputOffset += eventLayout.unorderedBytes;
  output.set(metadataSection, outputOffset);

  return output;
}

function validateSectionOffsets(
  fileLength: number,
  eventSizesOffset: number,
  gameStartOffset: number,
  metadataOffset: number,
  compressedEventsOffset: number,
): void {
  const valid =
    eventSizesOffset === SLPZ_HEADER_BYTES &&
    gameStartOffset > eventSizesOffset &&
    metadataOffset > gameStartOffset &&
    compressedEventsOffset >= metadataOffset &&
    compressedEventsOffset < fileLength;

  if (!valid) {
    throw new SlpzDecodeError(
      "invalid-sections",
      ".slpz section offsets are out of order, out of bounds, or non-contiguous with the header.",
    );
  }
}

function parseEventSizes(section: Uint8Array): Uint16Array {
  if (section.byteLength < 2 || section[0] !== EVENT_PAYLOADS) {
    throw new SlpzDecodeError(
      "invalid-event-sizes",
      ".slpz event-size section is missing its 0x35 command.",
    );
  }

  const infoSize = section[1]!;
  const entryBytes = infoSize - 1;
  if (
    infoSize < 1 ||
    entryBytes % 3 !== 0 ||
    section.byteLength !== infoSize + 1
  ) {
    throw new SlpzDecodeError(
      "invalid-event-sizes",
      ".slpz event-size table has an invalid or inconsistent length.",
    );
  }

  const sizes = new Uint16Array(256);
  const seen = new Uint8Array(256);
  for (let offset = 2; offset < section.byteLength; offset += 3) {
    const command = section[offset]!;
    if (seen[command] !== 0) {
      throw new SlpzDecodeError(
        "invalid-event-sizes",
        `.slpz event-size table repeats command 0x${command.toString(16).padStart(2, "0")}.`,
      );
    }
    seen[command] = 1;
    sizes[command] = (section[offset + 1]! << 8) | section[offset + 2]!;
  }

  return sizes;
}

function validateGameStart(section: Uint8Array, eventSizes: Uint16Array): void {
  const payloadSize = eventSizes[GAME_START]!;
  if (
    payloadSize === 0 ||
    section.byteLength !== payloadSize + 1 ||
    section[0] !== GAME_START
  ) {
    throw new SlpzDecodeError(
      "invalid-game-start",
      ".slpz game-start section does not match the event-size table.",
    );
  }
}

/**
 * Validate the single zstd frame emitted by the reference compressor before
 * fzstd allocates its history window. This also rejects trailing frames.
 */
function validateSingleZstdFrame(frame: Uint8Array, expectedSize: number): void {
  if (frame.byteLength < 6 || readUint32LE(frame, 0) !== ZSTD_MAGIC) {
    throw new SlpzDecodeError(
      "decompression-failed",
      ".slpz compressed-events section is not a zstd frame.",
    );
  }

  const descriptor = frame[4]!;
  if ((descriptor & 0x18) !== 0) {
    throw new SlpzDecodeError(
      "decompression-failed",
      ".slpz zstd frame uses reserved header bits.",
    );
  }

  const singleSegment = (descriptor & 0x20) !== 0;
  const hasChecksum = (descriptor & 0x04) !== 0;
  const dictionaryFlag = descriptor & 0x03;
  const contentSizeFlag = descriptor >>> 6;
  let offset = 5;

  if (!singleSegment) {
    requireBytes(frame, offset, 1, "zstd window descriptor");
    const windowDescriptor = frame[offset]!;
    offset += 1;
    const windowBase = 2 ** (10 + (windowDescriptor >>> 3));
    const windowSize = windowBase + (windowBase / 8) * (windowDescriptor & 0x07);
    if (!Number.isSafeInteger(windowSize) || windowSize > MAX_DECOMPRESSED_EVENTS_BYTES) {
      throw new SlpzSizeLimitError(windowSize);
    }
  }

  const dictionaryBytes = [0, 1, 2, 4][dictionaryFlag]!;
  requireBytes(frame, offset, dictionaryBytes, "zstd dictionary ID");
  offset += dictionaryBytes;

  const contentSizeBytes =
    contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 2 ** contentSizeFlag;
  if (contentSizeBytes === 0) {
    throw new SlpzDecodeError(
      "decompressed-size-mismatch",
      ".slpz zstd frame does not declare its decompressed size.",
    );
  }
  requireBytes(frame, offset, contentSizeBytes, "zstd content size");
  let frameContentSize = readLittleEndianBigInt(frame, offset, contentSizeBytes);
  if (contentSizeBytes === 2) frameContentSize += 256n;
  if (frameContentSize !== BigInt(expectedSize)) {
    throw new SlpzDecodeError(
      "decompressed-size-mismatch",
      `.slpz declares ${expectedSize} decompressed event bytes, but its zstd frame declares ${frameContentSize}.`,
    );
  }
  offset += contentSizeBytes;

  let lastBlock = false;
  while (!lastBlock) {
    requireBytes(frame, offset, 3, "zstd block header");
    const blockHeader =
      frame[offset]! | (frame[offset + 1]! << 8) | (frame[offset + 2]! << 16);
    offset += 3;
    lastBlock = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 0x03;
    const blockSize = blockHeader >>> 3;
    if (blockType === 3) {
      throw new SlpzDecodeError(
        "decompression-failed",
        ".slpz zstd frame contains a reserved block type.",
      );
    }
    const encodedSize = blockType === 1 ? 1 : blockSize;
    requireBytes(frame, offset, encodedSize, "zstd block");
    offset += encodedSize;
  }

  if (hasChecksum) {
    requireBytes(frame, offset, 4, "zstd checksum");
    offset += 4;
  }
  if (offset !== frame.byteLength) {
    throw new SlpzDecodeError(
      "decompression-failed",
      ".slpz compressed-events section contains trailing data or multiple zstd frames.",
    );
  }
}

function decompressExact(compressed: Uint8Array, expectedSize: number): Uint8Array {
  const output = allocate(expectedSize);
  let written = 0;
  let finished = false;

  try {
    const decompressor = new Decompress((chunk, final) => {
      if (chunk.byteLength > expectedSize - written) {
        throw new SlpzDecodeError(
          "decompressed-size-mismatch",
          `.slpz decompressed event data exceeds its declared ${expectedSize} bytes.`,
        );
      }
      output.set(chunk, written);
      written += chunk.byteLength;
      if (final) finished = true;
    });
    decompressor.push(compressed, true);
  } catch (error) {
    if (error instanceof SlpzDecodeError) throw error;
    throw new SlpzDecodeError(
      "decompression-failed",
      ".slpz event decompression failed.",
      { cause: error },
    );
  }

  if (!finished || written !== expectedSize) {
    throw new SlpzDecodeError(
      "decompressed-size-mismatch",
      `.slpz declares ${expectedSize} decompressed event bytes, but zstd produced ${written}.`,
    );
  }
  return output;
}

interface EventLayout {
  counts: Uint32Array;
  payloadOffsets: Uint32Array;
  totalEvents: number;
  unorderedBytes: number;
}

function validateReorderedEvents(
  reordered: Uint8Array,
  eventSizes: Uint16Array,
): EventLayout {
  if (reordered.byteLength < 4) {
    throw new SlpzDecodeError(
      "invalid-events",
      ".slpz reordered event data is missing its event count.",
    );
  }

  const totalEvents = new DataView(
    reordered.buffer,
    reordered.byteOffset,
    4,
  ).getUint32(0, false);
  if (totalEvents > reordered.byteLength - 4) {
    throw new SlpzDecodeError(
      "invalid-events",
      ".slpz reordered event list is truncated.",
    );
  }

  const counts = new Uint32Array(256);
  for (let index = 0; index < totalEvents; index += 1) {
    const command = reordered[4 + index]!;
    if (eventSizes[command] === 0) {
      throw new SlpzDecodeError(
        "invalid-events",
        `.slpz event 0x${command.toString(16).padStart(2, "0")} is absent from its size table.`,
      );
    }
    counts[command] = counts[command]! + 1;
  }

  const payloadOffsets = new Uint32Array(256);
  let payloadBytes = 0;
  for (let command = 0; command < 256; command += 1) {
    payloadOffsets[command] = payloadBytes;
    payloadBytes += counts[command]! * eventSizes[command]!;
    if (!Number.isSafeInteger(payloadBytes)) {
      throw new SlpzDecodeError(
        "invalid-events",
        ".slpz reordered event sizes overflow the supported range.",
      );
    }
  }

  const expectedLength = 4 + totalEvents + payloadBytes;
  if (expectedLength !== reordered.byteLength) {
    throw new SlpzDecodeError(
      "invalid-events",
      ".slpz reordered event payload does not match its event IDs and size table.",
    );
  }

  return {
    counts,
    payloadOffsets,
    totalEvents,
    unorderedBytes: totalEvents + payloadBytes,
  };
}

function unorderEventsInto(
  reordered: Uint8Array,
  eventSizes: Uint16Array,
  layout: EventLayout,
  output: Uint8Array,
  outputOffset: number,
): void {
  const payloadStart = 4 + layout.totalEvents;
  const writtenByCommand = new Uint32Array(256);
  let target = outputOffset;

  for (let index = 0; index < layout.totalEvents; index += 1) {
    const command = reordered[4 + index]!;
    const payloadSize = eventSizes[command]!;
    const commandCount = layout.counts[command]!;
    const occurrence = writtenByCommand[command]!;
    const commandPayloadStart = payloadStart + layout.payloadOffsets[command]!;

    output[target] = command;
    target += 1;
    for (let byte = 0; byte < payloadSize; byte += 1) {
      output[target + byte] =
        reordered[commandPayloadStart + occurrence + byte * commandCount]!;
    }
    target += payloadSize;
    writtenByCommand[command] = occurrence + 1;
  }
}

function allocate(length: number): Uint8Array<ArrayBuffer> {
  try {
    return new Uint8Array(length);
  } catch (error) {
    throw new SlpzDecodeError(
      "size-limit",
      `.slpz requires a ${length}-byte allocation that this browser cannot provide.`,
      { cause: error },
    );
  }
}

function requireBytes(
  bytes: Uint8Array,
  offset: number,
  length: number,
  label: string,
): void {
  if (offset > bytes.byteLength - length) {
    throw new SlpzDecodeError(
      "decompression-failed",
      `.slpz ${label} is truncated.`,
    );
  }
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function readLittleEndianBigInt(
  bytes: Uint8Array,
  offset: number,
  length: number,
): bigint {
  let value = 0n;
  for (let index = length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]!);
  }
  return value;
}
