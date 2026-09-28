import AdmZip from 'adm-zip'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Extract content-slide background from a conference PPTX template.
 * Prefers the non-title layout background (typically image2 / second media image).
 * Falls back to the largest non-first image, then any image.
 */
export function extractTemplateBackground(
  pptxPath: string,
  destPath: string,
): { backgroundPath: string; sourceImage: string } {
  const zip = new AdmZip(pptxPath)
  const entries = zip.getEntries()

  const layoutRels = entries.filter(
    (e) =>
      e.entryName.startsWith('ppt/slideLayouts/_rels/') &&
      e.entryName.endsWith('.rels'),
  )

  type Candidate = { layoutName: string; imagePath: string; isTitle: boolean }
  const candidates: Candidate[] = []

  for (const rel of layoutRels) {
    const layoutName = path.basename(rel.entryName, '.xml.rels')
    const layoutEntry = entries.find(
      (e) => e.entryName === `ppt/slideLayouts/${layoutName}.xml`,
    )
    const layoutXml = layoutEntry?.getData().toString('utf8') ?? ''
    const isTitle =
      /type="title"/i.test(layoutXml) || /Slajd tytułowy/i.test(layoutXml)

    const relXml = rel.getData().toString('utf8')
    const imageMatch = relXml.match(
      /Type="[^"]*\/image"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Type="[^"]*\/image"/,
    )
    const target = imageMatch?.[1] || imageMatch?.[2]
    if (!target) continue
    const imagePath = path.posix.normalize(
      path.posix.join(path.posix.dirname(rel.entryName.replace('/_rels', '')), target),
    )
    candidates.push({ layoutName, imagePath, isTitle })
  }

  // Prefer non-title layout background
  let chosen =
    candidates.find((c) => !c.isTitle) ||
    candidates[candidates.length - 1] ||
    null

  if (!chosen) {
    // Fallback: pick media images, prefer second / smaller content bg
    const media = entries
      .filter((e) => e.entryName.startsWith('ppt/media/'))
      .map((e) => ({
        path: e.entryName,
        size: e.header.size,
        name: path.basename(e.entryName),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    if (media.length === 0) {
      throw new Error('Szablon PPTX nie zawiera obrazów tła')
    }
    const pick = media.length > 1 ? media[1] : media[0]
    chosen = { layoutName: 'fallback', imagePath: pick.path, isTitle: false }
  }

  const imageEntry = entries.find((e) => e.entryName === chosen!.imagePath)
  if (!imageEntry) {
    throw new Error(`Nie znaleziono obrazu tła: ${chosen.imagePath}`)
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  // Keep extension from source
  const ext = path.extname(chosen.imagePath) || '.png'
  const finalPath = destPath.endsWith(ext) ? destPath : destPath.replace(/\.[^.]+$/, '') + ext
  fs.writeFileSync(finalPath, imageEntry.getData())

  return { backgroundPath: finalPath, sourceImage: chosen.imagePath }
}
