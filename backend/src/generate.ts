import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { imageSize } from 'image-size'
// pptxgenjs ships awkward CJS/namespace typings under NodeNext
import PptxGenJSImport from 'pptxgenjs'

type PptxPres = {
  defineLayout: (l: { name: string; width: number; height: number }) => void
  layout: string
  author: string
  title: string
  addSlide: () => PptxSlide
  writeFile: (opts: { fileName: string }) => Promise<string>
}
type PptxSlide = {
  addImage: (opts: Record<string, unknown>) => void
  addText: (text: unknown, opts?: Record<string, unknown>) => void
}
const PptxGenJS = PptxGenJSImport as unknown as { new (): PptxPres }
import AdmZip from 'adm-zip'
import { db, projectDir } from './db.js'
import { ensureJpegPath } from './heic.js'
import type {
  PartnerRow,
  PhotoRow,
  ProjectRow,
  StatsContent,
  TierRow,
} from './types.js'

const SLIDE_W = 13.333
const SLIDE_H = 7.5

type PhotoWithAssignments = PhotoRow & {
  partnerIds: string[]
  tierIds: string[]
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function loadPhotos(projectId: string): PhotoWithAssignments[] {
  const photos = db
    .prepare(
      `SELECT * FROM photos WHERE project_id = ? AND excluded = 0 AND category IS NOT NULL`,
    )
    .all(projectId) as PhotoRow[]

  const partnerLinks = db
    .prepare(
      `SELECT pp.photo_id, pp.partner_id FROM photo_partners pp
       JOIN photos p ON p.id = pp.photo_id WHERE p.project_id = ?`,
    )
    .all(projectId) as { photo_id: string; partner_id: string }[]

  const tierLinks = db
    .prepare(
      `SELECT pt.photo_id, pt.tier_id FROM photo_tiers pt
       JOIN photos p ON p.id = pt.photo_id WHERE p.project_id = ?`,
    )
    .all(projectId) as { photo_id: string; tier_id: string }[]

  const partnersByPhoto = new Map<string, string[]>()
  for (const l of partnerLinks) {
    const arr = partnersByPhoto.get(l.photo_id) ?? []
    arr.push(l.partner_id)
    partnersByPhoto.set(l.photo_id, arr)
  }
  const tiersByPhoto = new Map<string, string[]>()
  for (const l of tierLinks) {
    const arr = tiersByPhoto.get(l.photo_id) ?? []
    arr.push(l.tier_id)
    tiersByPhoto.set(l.photo_id, arr)
  }

  return photos.map((p) => ({
    ...p,
    partnerIds: partnersByPhoto.get(p.id) ?? [],
    tierIds: tiersByPhoto.get(p.id) ?? [],
  }))
}

function belongsToPartner(photo: PhotoWithAssignments, partner: PartnerRow) {
  if (photo.partnerIds.length === 0 && photo.tierIds.length === 0) return true
  if (photo.partnerIds.includes(partner.id)) return true
  if (photo.tierIds.includes(partner.tier_id)) return true
  return false
}

/** Within cat 13/14: collective (tiers only) → company → none */
function splitSortKey(photo: PhotoWithAssignments): number {
  const hasTiers = photo.tierIds.length > 0
  const hasPartners = photo.partnerIds.length > 0
  if (hasTiers && !hasPartners) return 0
  if (hasPartners) return 1
  return 2
}

function sortPhotosForPartner(photos: PhotoWithAssignments[]) {
  return [...photos].sort((a, b) => {
    const ca = a.category ?? 99
    const cb = b.category ?? 99
    if (ca !== cb) return ca - cb
    if (ca === 13 || ca === 14) {
      const sa = splitSortKey(a)
      const sb = splitSortKey(b)
      if (sa !== sb) return sa - sb
    }
    return naturalCompare(a.original_name, b.original_name)
  })
}

function absolutePhotoPath(projectId: string, relativePath: string) {
  return path.isAbsolute(relativePath)
    ? relativePath
    : path.join(projectDir(projectId), relativePath)
}

async function resolvePhotoPath(projectId: string, photo: PhotoWithAssignments) {
  const abs = absolutePhotoPath(projectId, photo.path)
  const jpeg = await ensureJpegPath(abs, photo.original_name)
  if (jpeg !== abs) {
    const rel = path.relative(projectDir(projectId), jpeg)
    db.prepare('UPDATE photos SET path = ? WHERE id = ?').run(rel, photo.id)
  }
  return jpeg
}

function containBox(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(boxW / imgW, boxH / imgH)
  const w = imgW * scale
  const h = imgH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

async function addImageSlide(
  pptx: PptxPres,
  opts: {
    imagePath: string
    backgroundPath: string | null
    cover: boolean
  },
) {
  const slide = pptx.addSlide()
  if (!opts.cover && opts.backgroundPath && fs.existsSync(opts.backgroundPath)) {
    slide.addImage({
      path: opts.backgroundPath,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
    })
  }

  if (opts.cover) {
    slide.addImage({
      path: opts.imagePath,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
    })
    return
  }

  let dims: { width?: number; height?: number }
  try {
    dims = imageSize(fs.readFileSync(opts.imagePath))
  } catch {
    dims = { width: 1920, height: 1080 }
  }
  const iw = dims.width || 1920
  const ih = dims.height || 1080
  const box = containBox(iw, ih, SLIDE_W, SLIDE_H)
  slide.addImage({
    path: opts.imagePath,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
  })
}

function addEventPageSlide(
  pptx: PptxPres,
  backgroundPath: string | null,
  eventUrl: string,
) {
  const slide = pptx.addSlide()
  if (backgroundPath && fs.existsSync(backgroundPath)) {
    slide.addImage({
      path: backgroundPath,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
    })
  }
  slide.addText('Strona wydarzenia', {
    x: 0.89,
    y: 1.77,
    w: 11.5,
    h: 1.0,
    fontFace: 'Arial',
    fontSize: 24,
    bold: true,
    color: '333333',
    align: 'left',
    valign: 'middle',
  })
  const url = eventUrl.trim() || 'https://'
  slide.addText(url, {
    x: 0.89,
    y: 3.35,
    w: 11.5,
    h: 0.6,
    fontFace: 'Arial',
    fontSize: 16,
    color: '0563C1',
    hyperlink: { url },
    align: 'left',
  })
}

function addStatsSlide(
  pptx: PptxPres,
  backgroundPath: string | null,
  stats: StatsContent,
) {
  const slide = pptx.addSlide()
  if (backgroundPath && fs.existsSync(backgroundPath)) {
    slide.addImage({
      path: backgroundPath,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
    })
  }
  slide.addText(stats.title || 'Statystyki', {
    x: 0.89,
    y: 1.77,
    w: 11.5,
    h: 0.8,
    fontFace: 'Arial',
    fontSize: 24,
    bold: true,
    color: '333333',
    align: 'left',
    valign: 'middle',
  })

  const lines = stats.lines || []
  const textItems = lines.map((line, i) => ({
    text: line.text,
    options: {
      bullet: line.type === 'bullet',
      breakLine: i < lines.length - 1,
      fontFace: 'Arial',
      fontSize: 16,
      color: '333333',
    },
  }))

  if (textItems.length > 0) {
    slide.addText(textItems, {
      x: 0.89,
      y: 2.7,
      w: 11.5,
      h: 3.5,
      align: 'left',
      valign: 'top',
    })
  }
}

async function buildPartnerPptx(opts: {
  project: ProjectRow
  partner: PartnerRow
  photos: PhotoWithAssignments[]
  backgroundPath: string | null
  stats: StatsContent
  outPath: string
}) {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'WIDESCREEN_16x9', width: SLIDE_W, height: SLIDE_H })
  pptx.layout = 'WIDESCREEN_16x9'
  pptx.author = 'Raport Generator'
  pptx.title = `Raport — ${opts.partner.name}`

  const sorted = sortPhotosForPartner(
    opts.photos.filter((p) => belongsToPartner(p, opts.partner)),
  )

  // Category 1 banners first (cover)
  for (const photo of sorted.filter((p) => p.category === 1)) {
    await addImageSlide(pptx, {
      imagePath: await resolvePhotoPath(opts.project.id, photo),
      backgroundPath: opts.backgroundPath,
      cover: true,
    })
  }

  addEventPageSlide(pptx, opts.backgroundPath, opts.project.event_url)
  addStatsSlide(pptx, opts.backgroundPath, opts.stats)

  for (const photo of sorted.filter((p) => p.category !== 1 && p.category !== 15)) {
    await addImageSlide(pptx, {
      imagePath: await resolvePhotoPath(opts.project.id, photo),
      backgroundPath: opts.backgroundPath,
      cover: false,
    })
  }

  for (const photo of sorted.filter((p) => p.category === 15)) {
    await addImageSlide(pptx, {
      imagePath: await resolvePhotoPath(opts.project.id, photo),
      backgroundPath: opts.backgroundPath,
      cover: true,
    })
  }

  await pptx.writeFile({ fileName: opts.outPath })
}

function convertPptxToPdf(pptxPath: string, outDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const soffice =
      process.env.LIBREOFFICE_PATH ||
      (fs.existsSync('/usr/bin/soffice') ? '/usr/bin/soffice' : 'soffice')

    const args = [
      '--headless',
      '--norestore',
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      pptxPath,
    ]

    const child = spawn(soffice, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      reject(
        new Error(
          `Nie udało się uruchomić LibreOffice (${soffice}): ${err.message}`,
        ),
      )
    })
    child.on('close', (code) => {
      const base = path.basename(pptxPath, path.extname(pptxPath))
      const pdfPath = path.join(outDir, `${base}.pdf`)
      if (code !== 0 || !fs.existsSync(pdfPath)) {
        reject(
          new Error(
            `Konwersja PDF nie powiodła się (kod ${code}). ${stderr || 'Brak LibreOffice?'}`,
          ),
        )
        return
      }
      resolve(pdfPath)
    })
  })
}

function safeFileName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'partner'
}

export async function generateReportsZip(projectId: string): Promise<string> {
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(projectId) as ProjectRow | undefined
  if (!project) throw new Error('Projekt nie istnieje')

  const partners = db
    .prepare('SELECT * FROM partners WHERE project_id = ? ORDER BY name')
    .all(projectId) as PartnerRow[]
  if (partners.length === 0) throw new Error('Brak partnerów w projekcie')

  const photos = loadPhotos(projectId)
  const stats = JSON.parse(project.stats_json) as StatsContent
  const backgroundPath = project.background_path

  const outRoot = path.join(projectDir(projectId), 'output')
  fs.rmSync(outRoot, { recursive: true, force: true })
  fs.mkdirSync(outRoot, { recursive: true })

  const zip = new AdmZip()
  const errors: string[] = []

  for (const partner of partners) {
    const base = safeFileName(partner.name)
    const pptxPath = path.join(outRoot, `${base}.pptx`)
    await buildPartnerPptx({
      project,
      partner,
      photos,
      backgroundPath,
      stats,
      outPath: pptxPath,
    })
    zip.addLocalFile(pptxPath)

    try {
      const pdfPath = await convertPptxToPdf(pptxPath, outRoot)
      zip.addLocalFile(pdfPath)
    } catch (err) {
      errors.push(
        `${partner.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (errors.length > 0) {
    zip.addFile(
      'PDF_ERRORS.txt',
      Buffer.from(
        'Nie udało się wygenerować PDF dla:\n' + errors.join('\n') + '\n',
        'utf8',
      ),
    )
  }

  const zipPath = path.join(outRoot, 'raporty.zip')
  zip.writeZip(zipPath)
  return zipPath
}

export type { TierRow }
