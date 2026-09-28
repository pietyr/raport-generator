import convert from 'heic-convert'
import fs from 'node:fs'
import path from 'node:path'

const HEIC_EXT = new Set(['.heic', '.heif', '.heics', '.avci'])

function isHeicFtyp(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false
  if (buf.toString('ascii', 4, 8) !== 'ftyp') return false
  const brand = buf.toString('ascii', 8, 12).toLowerCase()
  return (
    brand === 'heic' ||
    brand === 'heix' ||
    brand === 'heif' ||
    brand === 'mif1' ||
    brand === 'msf1' ||
    brand === 'heim' ||
    brand === 'heis'
  )
}

function isJpegOrPng(buf: Buffer): boolean {
  if (!buf || buf.length < 4) return false
  // JPEG SOI
  if (buf[0] === 0xff && buf[1] === 0xd8) return true
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return true
  }
  return false
}

/**
 * Detect HEIC/HEIF. Buffer content wins over filename so that a file already
 * converted to JPEG but still named *.HEIC is not re-decoded as HEIC.
 */
export function isHeic(filename: string, buf?: Buffer): boolean {
  if (buf && buf.length >= 12) {
    if (isHeicFtyp(buf)) return true
    if (isJpegOrPng(buf)) return false
  }
  const ext = path.extname(filename).toLowerCase()
  return HEIC_EXT.has(ext)
}

export async function heicToJpeg(buf: Buffer, quality = 0.92): Promise<Buffer> {
  const output = await convert({
    buffer: buf,
    format: 'JPEG',
    quality,
  })
  return Buffer.from(output)
}

function readHeader(filePath: string): Buffer {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    return head
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * If file CONTENT is HEIC/HEIF, convert to sibling .jpg and return new path.
 * Filename alone is not enough (avoids re-converting already-JPEG files).
 */
export async function ensureJpegPath(
  absPath: string,
  originalName?: string,
): Promise<string> {
  if (!fs.existsSync(absPath)) return absPath
  const head = readHeader(absPath)
  if (!isHeic(absPath, head) && !(originalName && isHeic(originalName, head))) {
    return absPath
  }
  const jpeg = await heicToJpeg(fs.readFileSync(absPath))
  const jpegPath = absPath.replace(/\.[^.]+$/, '') + '.jpg'
  fs.writeFileSync(jpegPath, jpeg)
  if (jpegPath !== absPath) fs.rmSync(absPath, { force: true })
  return jpegPath
}
