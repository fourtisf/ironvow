/**
 * Divergence detection.
 *
 * The checksum is taken over the exact IEEE-754 bits of the state the client
 * and the server are each supposed to arrive at. Quantising first would hide
 * precisely the last-bit drift this is here to catch, so it does not.
 *
 * A mismatch is not proof of cheating. A spike in mismatches almost always
 * means a determinism bug in the simulation (spec S4.6).
 */
export class Checksum {
  private h1 = 0x811c9dc5;
  private h2 = 0x01000193;
  private readonly buf = new DataView(new ArrayBuffer(8));

  addInt(v: number): this {
    let x = v | 0;
    for (let b = 0; b < 4; b++) {
      this.mix(x & 0xff);
      x >>>= 8;
    }
    return this;
  }

  /** Hashes all 64 bits of the double, so 0.1 + 0.2 and 0.3 do not collide. */
  addFloat(v: number): this {
    this.buf.setFloat64(0, v, true);
    for (let b = 0; b < 8; b++) this.mix(this.buf.getUint8(b));
    return this;
  }

  addString(s: string): this {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.mix(c & 0xff);
      this.mix((c >>> 8) & 0xff);
    }
    return this;
  }

  private mix(byte: number): void {
    this.h1 = Math.imul(this.h1 ^ byte, 0x01000193) >>> 0;
    this.h2 = Math.imul(this.h2 + byte + 1, 0x85ebca6b) >>> 0;
    this.h2 = (this.h2 ^ (this.h2 >>> 13)) >>> 0;
  }

  /** A detached copy, so finalising a running battle cannot disturb it. */
  clone(): Checksum {
    const c = new Checksum();
    c.h1 = this.h1;
    c.h2 = this.h2;
    return c;
  }

  digest(): string {
    return this.h1.toString(16).padStart(8, '0') + this.h2.toString(16).padStart(8, '0');
  }
}
