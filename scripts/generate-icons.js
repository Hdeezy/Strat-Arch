// Generates minimal valid PNG icon files for the HOPE Card PWA.
// Solid hope-dark-green (#2D6A4F) background with a white rounded "H" mark.
// Run once: node scripts/generate-icons.js

const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ─── CRC32 (PNG spec) ────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : (c >>> 1)
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf  = Buffer.concat([typeBuf, data])
  const out = Buffer.alloc(4 + 4 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  typeBuf.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length)
  return out
}

// ─── Draw into an RGBA pixel buffer ─────────────────────────────────────────

function setPixel(buf, w, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= w || y >= w) return
  const off = (y * w + x) * 4
  buf[off] = r; buf[off+1] = g; buf[off+2] = b; buf[off+3] = a
}

function fillRect(buf, w, x1, y1, x2, y2, r, g, b) {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      setPixel(buf, w, x, y, r, g, b)
}

function fillRoundRect(buf, w, x1, y1, x2, y2, radius, r, g, b) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      // corner proximity check
      let inCorner = false
      const cx = (x < x1 + radius) ? x1 + radius : (x > x2 - radius ? x2 - radius : x)
      const cy = (y < y1 + radius) ? y1 + radius : (y > y2 - radius ? y2 - radius : y)
      const dx = x - cx, dy = y - cy
      inCorner = dx*dx + dy*dy > radius*radius
      if (!inCorner) setPixel(buf, w, x, y, r, g, b)
    }
  }
}

function drawHopeMark(buf, size) {
  // Background: hope-dark (#1B4332)
  const BG = [0x1B, 0x43, 0x32]
  // Card face: hope-green (#2D6A4F)
  const CARD = [0x2D, 0x6A, 0x4F]
  // White
  const W = [255, 255, 255]

  // Background fill
  fillRect(buf, size, 0, 0, size-1, size-1, ...BG)

  // Rounded card shape in center
  const pad  = Math.round(size * 0.08)
  const r    = Math.round(size * 0.1)
  fillRoundRect(buf, size, pad, pad, size-1-pad, size-1-pad, r, ...CARD)

  // White "H" letterform
  const cx   = Math.floor(size / 2)
  const cy   = Math.floor(size / 2)
  const arm  = Math.round(size * 0.13)  // half-height of H arms
  const stem = Math.round(size * 0.04)  // half-width of each stem
  const gap  = Math.round(size * 0.065) // half-gap between stems

  // Left vertical bar
  fillRect(buf, size, cx - gap - stem, cy - arm, cx - gap + stem, cy + arm, ...W)
  // Right vertical bar
  fillRect(buf, size, cx + gap - stem, cy - arm, cx + gap + stem, cy + arm, ...W)
  // Crossbar
  fillRect(buf, size, cx - gap + stem, cy - stem, cx + gap - stem, cy + stem, ...W)
}

// ─── Build PNG from RGBA buffer ──────────────────────────────────────────────

function buildPNG(size) {
  const rgba = new Uint8Array(size * size * 4)
  drawHopeMark(rgba, size)

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8]  = 8 // bit depth
  ihdr[9]  = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // Scanlines with filter byte 0 (None) prepended to each row
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const off = y * (size * 4 + 1)
    raw[off] = 0 // filter None
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, off + 1)
  }

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 }))
  const iend = pngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([sig, pngChunk('IHDR', ihdr), idat, iend])
}

// ─── Write files ─────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(outDir, { recursive: true })

for (const size of [192, 512]) {
  const dest = path.join(outDir, `icon-${size}.png`)
  fs.writeFileSync(dest, buildPNG(size))
  console.log(`✓ ${dest} (${fs.statSync(dest).size} bytes)`)
}

console.log('PWA icons generated.')
