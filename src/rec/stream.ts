/**
 * A small read cursor over a Buffer. All numbers are little-endian.
 * When there are not enough bytes left, every read throws `NeedMoreData`.
 * The caller catches that and waits for more bytes.
 */
export class NeedMoreData extends Error {
  constructor() {
    super("need more data");
  }
}

export class Stream {
  pos = 0;

  constructor(readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new NeedMoreData();
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.buf.length) throw new NeedMoreData();
    this.pos = offset;
  }

  bytes(n: number): Buffer {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  i8(): number {
    this.need(1);
    return this.buf.readInt8(this.pos++);
  }

  i16(): number {
    this.need(2);
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  u64(): bigint {
    this.need(8);
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  /** Reads a u32 without moving the cursor. */
  peekU32(): number {
    this.need(4);
    return this.buf.readUInt32LE(this.pos);
  }
}
