import convert from 'heic-convert'
import fs from 'node:fs'
import path from 'node:path'

const HEIC_EXT = new Set(['.heic', '.heif', '.heics', '.avci'])

/** Detect HEIC/HEIF by extension or ftyp brand in the buffer. */
export function isHeic(filename: string, buf?: Buffer): boolean {
  const ext = path.extname(filename).toLowerCase()
  if (HEIC_EXT.has(ext)) return true
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
 * If file is HEIC/HEIF, convert in place to sibling .jpg and return new path.
 * Otherwise return the original path.
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
