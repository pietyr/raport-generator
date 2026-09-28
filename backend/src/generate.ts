import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { imageSize } from 'image-size'
import PptxGenJSImport from 'pptxgenjs'
import AdmZip from 'adm-zip'
import { db, projectDir } from './db.js'
import { preparePhotoDerivatives } from './images.js'
import type {
  PartnerRow,
  PhotoRow,
  ProjectRow,
  StatsContent,
  TierRow,
} from './types.js'

const SLIDE_W = 13.333
const SLIDE_H = 7.5

type PptxPres = {
  defineLayout: (l: { name: string; width: number; height: number }) => void
  layout: string
  author: string
  title: string
  addSlide: () => PptxSlide
  writeFile: (opts: { fileName: string }) => Promise<string>
}
type PptxSlide = {
  background?: { color: string }
  addImage: (opts: Record<string, unknown>) => void
  addText: (text: unknown, opts?: Record<string, unknown>) => void
}
const PptxGenJS = PptxGenJSImport as unknown as { new (): PptxPres }

type PhotoWithAssignments = PhotoRow & {
  partnerIds: string[]
  tierIds: string[]
}

export type GenerateProgress = {
  done: number
  total: number
  phase: string
  message: string
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
  const prepared = await preparePhotoDerivatives(abs, photo.original_name)
  if (prepared.full !== abs) {
    const rel = path.relative(projectDir(projectId), prepared.full)
    db.prepare('UPDATE photos SET path = ? WHERE id = ?').run(rel, photo.id)
  }
  return prepared.full
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

/** Photo slides: explicit white background (as in PowerPoint), never template bg. */
async function addImageSlide(
  pptx: PptxPres,
  opts: { imagePath: string; cover: boolean },
) {
  const slide = pptx.addSlide()
  slide.background = { color: 'FFFFFF' }

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
  slide.background = { color: 'FFFFFF' }
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
  slide.background = { color: 'FFFFFF' }
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

  for (const photo of sorted.filter((p) => p.category === 1)) {
    await addImageSlide(pptx, {
      imagePath: await resolvePhotoPath(opts.project.id, photo),
      cover: true,
    })
  }

  addEventPageSlide(pptx, opts.backgroundPath, opts.project.event_url)
  addStatsSlide(pptx, opts.backgroundPath, opts.stats)

  for (const photo of sorted.filter((p) => p.category !== 1 && p.category !== 15)) {
    await addImageSlide(pptx, {
      imagePath: await resolvePhotoPath(opts.project.id, photo),
      cover: false,
    })
  }

  for (const photo of sorted.filter((p) => p.category === 15)) {
    await addImageSlide(pptx, {
      imagePath: await resolvePhotoPath(opts.project.id, photo),
      cover: true,
    })
  }

  await pptx.writeFile({ fileName: opts.outPath })
}

function findSoffice(): string {
  if (process.env.LIBREOFFICE_PATH) return process.env.LIBREOFFICE_PATH
  for (const p of [
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
    '/usr/lib/libreoffice/program/soffice',
  ]) {
    if (fs.existsSync(p)) return p
  }
  return 'soffice'
}

function convertPptxToPdf(pptxPath: string, outDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const soffice = findSoffice()
    const profile = path.join('/tmp', `lo_profile_${randomUUID()}`)
    const args = [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      '--norestore',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to',
      'pdf:impress_pdf_Export',
      '--outdir',
      outDir,
      pptxPath,
    ]

    const child = spawn(soffice, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp', LANG: 'C.UTF-8' },
    })
    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
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
      fs.rmSync(profile, { recursive: true, force: true })
      const base = path.basename(pptxPath, path.extname(pptxPath))
      const pdfPath = path.join(outDir, `${base}.pdf`)
      if (code !== 0 || !fs.existsSync(pdfPath)) {
        reject(
          new Error(
            `Konwersja PDF nie powiodła się (kod ${code}). ${stderr || stdout || 'sprawdź LibreOffice w kontenerze'}`,
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

export async function generateReportsZip(
  projectId: string,
  onProgress?: (p: GenerateProgress) => void,
): Promise<string> {
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
  // Each partner: PPTX + PDF
  const total = partners.length * 2
  let done = 0

  const report = (phase: string, message: string) => {
    onProgress?.({ done, total, phase, message })
  }

  report('start', `Start generowania dla ${partners.length} firm…`)

  for (const partner of partners) {
    const base = safeFileName(partner.name)
    const pptxPath = path.join(outRoot, `${base}.pptx`)

    report('pptx', `PPTX: ${partner.name}`)
    await buildPartnerPptx({
      project,
      partner,
      photos,
      backgroundPath,
      stats,
      outPath: pptxPath,
    })
    zip.addLocalFile(pptxPath)
    done += 1
    report('pptx', `PPTX gotowe: ${partner.name}`)

    report('pdf', `PDF: ${partner.name}`)
    try {
      const pdfPath = await convertPptxToPdf(pptxPath, outRoot)
      zip.addLocalFile(pdfPath)
    } catch (err) {
      errors.push(
        `${partner.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    done += 1
    report('pdf', `PDF gotowe: ${partner.name}`)
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

  report('zip', 'Pakowanie ZIP…')
  const zipPath = path.join(outRoot, 'raporty.zip')
  zip.writeZip(zipPath)
  report('done', 'Gotowe')
  return zipPath
}

export type { TierRow }
