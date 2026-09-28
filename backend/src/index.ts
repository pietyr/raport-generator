import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { db, DATA_DIR, projectDir, UPLOADS_DIR, withTransaction } from './db.js'
import { defaultStats, PHOTO_CATEGORIES, type StatsContent } from './types.js'
import { extractTemplateBackground } from './template.js'
import { generateReportsZip } from './generate.js'
import { getJob, startGenerateJob } from './jobs.js'
import { heicToJpeg, isHeic } from './heic.js'
import {
  preparePhotoDerivatives,
  resolvePhotoVariant,
  withImageQueue,
  type PhotoVariant,
} from './images.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const isProd = process.env.NODE_ENV === 'production'

const app = Fastify({
  logger: true,
  bodyLimit: 512 * 1024 * 1024,
  requestTimeout: 0,
  connectionTimeout: 0,
})

await app.register(cors, { origin: true })
await app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024, files: 500 },
})

app.get('/api/health', async () => ({ ok: true }))

app.get('/api/categories', async () => PHOTO_CATEGORIES)

// ——— Projects ———

app.get('/api/projects', async () => {
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id) AS photo_count,
        (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id AND (ph.category IS NOT NULL OR ph.excluded = 1)) AS tagged_count,
        (SELECT COUNT(*) FROM partners pr WHERE pr.project_id = p.id) AS partner_count
       FROM projects p ORDER BY p.updated_at DESC`,
    )
    .all()
  return (rows as Record<string, unknown>[]).map((r) => ({
    ...r,
    stats: JSON.parse(String(r.stats_json)),
  }))
})

app.post<{ Body: { name?: string } }>('/api/projects', async (req, reply) => {
  const name = (req.body?.name || '').trim() || 'Nowa konferencja'
  const id = randomUUID()
  const now = new Date().toISOString()
  const stats = defaultStats()
  db.prepare(
    `INSERT INTO projects (id, name, event_url, template_path, background_path, stats_json, created_at, updated_at)
     VALUES (?, ?, '', NULL, NULL, ?, ?, ?)`,
  ).run(id, name, JSON.stringify(stats), now, now)
  projectDir(id)
  reply.code(201)
  return getProject(id)
})

function getProject(id: string) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return null
  const tiers = db
    .prepare(
      'SELECT * FROM tiers WHERE project_id = ? ORDER BY sort_order ASC, name ASC',
    )
    .all(id)
  const partners = db
    .prepare('SELECT * FROM partners WHERE project_id = ? ORDER BY name ASC')
    .all(id)
  const photoStats = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN category IS NOT NULL OR excluded = 1 THEN 1 ELSE 0 END) AS tagged
       FROM photos WHERE project_id = ?`,
    )
    .get(id) as { total: number; tagged: number }
  return {
    ...row,
    stats: JSON.parse(String(row.stats_json)),
    tiers,
    partners,
    photo_total: photoStats.total,
    photo_tagged: photoStats.tagged,
  }
}

app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
  const project = getProject(req.params.id)
  if (!project) return reply.code(404).send({ error: 'Nie znaleziono' })
  return project
})

app.patch<{
  Params: { id: string }
  Body: { name?: string; event_url?: string; stats?: StatsContent }
}>('/api/projects/:id', async (req, reply) => {
  const existing = db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(req.params.id)
  if (!existing) return reply.code(404).send({ error: 'Nie znaleziono' })

  const name = req.body.name
  const event_url = req.body.event_url
  const stats = req.body.stats
  const now = new Date().toISOString()

  if (name !== undefined) {
    db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(
      name.trim(),
      now,
      req.params.id,
    )
  }
  if (event_url !== undefined) {
    db.prepare(
      'UPDATE projects SET event_url = ?, updated_at = ? WHERE id = ?',
    ).run(event_url.trim(), now, req.params.id)
  }
  if (stats !== undefined) {
    db.prepare(
      'UPDATE projects SET stats_json = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(stats), now, req.params.id)
  }
  return getProject(req.params.id)
})

app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
  const existing = db
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(req.params.id)
  if (!existing) return reply.code(404).send({ error: 'Nie znaleziono' })
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id)
  const dir = path.join(UPLOADS_DIR, req.params.id)
  fs.rmSync(dir, { recursive: true, force: true })
  return { ok: true }
})

app.post<{ Params: { id: string } }>(
  '/api/projects/:id/template',
  async (req, reply) => {
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(req.params.id)
    if (!project) return reply.code(404).send({ error: 'Nie znaleziono' })

    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'Brak pliku' })

    const dir = projectDir(req.params.id)
    const templatePath = path.join(dir, 'template.pptx')
    const buf = await file.toBuffer()
    fs.writeFileSync(templatePath, buf)

    const bgBase = path.join(dir, 'background')
    const { backgroundPath } = extractTemplateBackground(templatePath, bgBase)

    const now = new Date().toISOString()
    db.prepare(
      `UPDATE projects SET template_path = ?, background_path = ?, updated_at = ? WHERE id = ?`,
    ).run(templatePath, backgroundPath, now, req.params.id)

    return getProject(req.params.id)
  },
)

// ——— Tiers & Partners ———

app.put<{
  Params: { id: string }
  Body: {
    tiers: { id?: string; name: string; sort_order: number }[]
    partners: { id?: string; tier_id: string; name: string; tier_temp_id?: string }[]
  }
}>('/api/projects/:id/partners', async (req, reply) => {
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ?')
    .get(req.params.id)
  if (!project) return reply.code(404).send({ error: 'Nie znaleziono' })

  const tiersInput = req.body.tiers || []
  const partnersInput = req.body.partners || []

  const replace = () => {
    // Clear photo links that would dangle — delete partners/tiers cascade via FK
    // but photo_partners/photo_tiers reference them. Safer: delete all partners & tiers
    // after clearing junction tables for this project's photos.
    const photoIds = (
      db
        .prepare('SELECT id FROM photos WHERE project_id = ?')
        .all(req.params.id) as { id: string }[]
    ).map((p) => p.id)

    if (photoIds.length) {
      const placeholders = photoIds.map(() => '?').join(',')
      db.prepare(
        `DELETE FROM photo_partners WHERE photo_id IN (${placeholders})`,
      ).run(...photoIds)
      db.prepare(
        `DELETE FROM photo_tiers WHERE photo_id IN (${placeholders})`,
      ).run(...photoIds)
    }

    db.prepare('DELETE FROM partners WHERE project_id = ?').run(req.params.id)
    db.prepare('DELETE FROM tiers WHERE project_id = ?').run(req.params.id)

    const tierIdMap = new Map<string, string>()

    for (const [i, t] of tiersInput.entries()) {
      const id = t.id && !t.id.startsWith('temp-') ? t.id : randomUUID()
      const tempKey = t.id || `idx-${i}`
      tierIdMap.set(tempKey, id)
      db.prepare(
        `INSERT INTO tiers (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)`,
      ).run(id, req.params.id, t.name.trim(), t.sort_order ?? i)
    }

    for (const p of partnersInput) {
      let tierId = p.tier_id
      if (tierId.startsWith('temp-') || tierIdMap.has(tierId)) {
        tierId = tierIdMap.get(tierId) || tierIdMap.get(p.tier_temp_id || '') || tierId
      }
      // Also resolve via temp map if client sent temp tier ids
      if (!db.prepare('SELECT id FROM tiers WHERE id = ?').get(tierId)) {
        const mapped = tierIdMap.get(p.tier_id)
        if (mapped) tierId = mapped
      }
      const id = p.id && !p.id.startsWith('temp-') ? p.id : randomUUID()
      db.prepare(
        `INSERT INTO partners (id, project_id, tier_id, name) VALUES (?, ?, ?, ?)`,
      ).run(id, req.params.id, tierId, p.name.trim())
    }

    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      req.params.id,
    )
  }

  try {
    withTransaction(replace)
  } catch (err) {
    return reply
      .code(400)
      .send({ error: err instanceof Error ? err.message : String(err) })
  }

  return getProject(req.params.id)
})

// Simpler tier/partner endpoints for incremental UI

app.post<{
  Params: { id: string }
  Body: { name: string }
}>('/api/projects/:id/tiers', async (req, reply) => {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
    return reply.code(404).send({ error: 'Nie znaleziono' })
  }
  const max = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM tiers WHERE project_id = ?',
    )
    .get(req.params.id) as { m: number }
  const id = randomUUID()
  db.prepare(
    `INSERT INTO tiers (id, project_id, name, sort_order) VALUES (?, ?, ?, ?)`,
  ).run(id, req.params.id, req.body.name.trim(), max.m + 1)
  touch(req.params.id)
  return getProject(req.params.id)
})

app.patch<{
  Params: { id: string; tierId: string }
  Body: { name?: string; sort_order?: number }
}>('/api/projects/:id/tiers/:tierId', async (req, reply) => {
  const tier = db
    .prepare('SELECT * FROM tiers WHERE id = ? AND project_id = ?')
    .get(req.params.tierId, req.params.id)
  if (!tier) return reply.code(404).send({ error: 'Nie znaleziono' })
  if (req.body.name !== undefined) {
    db.prepare('UPDATE tiers SET name = ? WHERE id = ?').run(
      req.body.name.trim(),
      req.params.tierId,
    )
  }
  if (req.body.sort_order !== undefined) {
    db.prepare('UPDATE tiers SET sort_order = ? WHERE id = ?').run(
      req.body.sort_order,
      req.params.tierId,
    )
  }
  touch(req.params.id)
  return getProject(req.params.id)
})

app.delete<{ Params: { id: string; tierId: string } }>(
  '/api/projects/:id/tiers/:tierId',
  async (req, reply) => {
    const tier = db
      .prepare('SELECT * FROM tiers WHERE id = ? AND project_id = ?')
      .get(req.params.tierId, req.params.id)
    if (!tier) return reply.code(404).send({ error: 'Nie znaleziono' })
    db.prepare('DELETE FROM partners WHERE tier_id = ?').run(req.params.tierId)
    db.prepare('DELETE FROM photo_tiers WHERE tier_id = ?').run(req.params.tierId)
    db.prepare('DELETE FROM tiers WHERE id = ?').run(req.params.tierId)
    touch(req.params.id)
    return getProject(req.params.id)
  },
)

app.post<{
  Params: { id: string }
  Body: { name: string; tier_id: string }
}>('/api/projects/:id/partners-item', async (req, reply) => {
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
    return reply.code(404).send({ error: 'Nie znaleziono' })
  }
  const tier = db
    .prepare('SELECT * FROM tiers WHERE id = ? AND project_id = ?')
    .get(req.body.tier_id, req.params.id)
  if (!tier) return reply.code(400).send({ error: 'Nieprawidłowy stopień' })
  const id = randomUUID()
  db.prepare(
    `INSERT INTO partners (id, project_id, tier_id, name) VALUES (?, ?, ?, ?)`,
  ).run(id, req.params.id, req.body.tier_id, req.body.name.trim())
  touch(req.params.id)
  return getProject(req.params.id)
})

app.patch<{
  Params: { id: string; partnerId: string }
  Body: { name?: string; tier_id?: string }
}>('/api/projects/:id/partners-item/:partnerId', async (req, reply) => {
  const partner = db
    .prepare('SELECT * FROM partners WHERE id = ? AND project_id = ?')
    .get(req.params.partnerId, req.params.id)
  if (!partner) return reply.code(404).send({ error: 'Nie znaleziono' })
  if (req.body.name !== undefined) {
    db.prepare('UPDATE partners SET name = ? WHERE id = ?').run(
      req.body.name.trim(),
      req.params.partnerId,
    )
  }
  if (req.body.tier_id !== undefined) {
    db.prepare('UPDATE partners SET tier_id = ? WHERE id = ?').run(
      req.body.tier_id,
      req.params.partnerId,
    )
  }
  touch(req.params.id)
  return getProject(req.params.id)
})

app.delete<{ Params: { id: string; partnerId: string } }>(
  '/api/projects/:id/partners-item/:partnerId',
  async (req, reply) => {
    const partner = db
      .prepare('SELECT * FROM partners WHERE id = ? AND project_id = ?')
      .get(req.params.partnerId, req.params.id)
    if (!partner) return reply.code(404).send({ error: 'Nie znaleziono' })
    db.prepare('DELETE FROM photo_partners WHERE partner_id = ?').run(
      req.params.partnerId,
    )
    db.prepare('DELETE FROM partners WHERE id = ?').run(req.params.partnerId)
    touch(req.params.id)
    return getProject(req.params.id)
  },
)

app.put<{
  Params: { id: string }
  Body: { order: string[] }
}>('/api/projects/:id/tiers/reorder', async (req, reply) => {
  const order = req.body.order || []
  withTransaction(() => {
    order.forEach((tierId, i) => {
      db.prepare(
        'UPDATE tiers SET sort_order = ? WHERE id = ? AND project_id = ?',
      ).run(i, tierId, req.params.id)
    })
  })
  touch(req.params.id)
  return getProject(req.params.id)
})

function touch(projectId: string) {
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    projectId,
  )
}

// ——— Photos ———

app.get<{ Params: { id: string } }>(
  '/api/projects/:id/photos',
  async (req, reply) => {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
      return reply.code(404).send({ error: 'Nie znaleziono' })
    }
    const photos = db
      .prepare(
        `SELECT * FROM photos WHERE project_id = ? ORDER BY original_name COLLATE NOCASE`,
      )
      .all(req.params.id) as {
      id: string
      original_name: string
      path: string
      category: number | null
      excluded: number
    }[]

    const withLinks = photos.map((p) => {
      const partnerIds = (
        db
          .prepare('SELECT partner_id FROM photo_partners WHERE photo_id = ?')
          .all(p.id) as { partner_id: string }[]
      ).map((r) => r.partner_id)
      const tierIds = (
        db
          .prepare('SELECT tier_id FROM photo_tiers WHERE photo_id = ?')
          .all(p.id) as { tier_id: string }[]
      ).map((r) => r.tier_id)
      return { ...p, partnerIds, tierIds }
    })

    withLinks.sort((a, b) =>
      a.original_name.localeCompare(b.original_name, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    )
    return withLinks
  },
)

app.post<{ Params: { id: string } }>(
  '/api/projects/:id/photos',
  async (req, reply) => {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
      return reply.code(404).send({ error: 'Nie znaleziono' })
    }
    const dir = path.join(projectDir(req.params.id), 'photos')
    fs.mkdirSync(dir, { recursive: true })

    const parts = req.files()
    const created: string[] = []
    const errors: string[] = []
    for await (const part of parts) {
      if (!part.file) continue
      const id = randomUUID()
      const originalName = part.filename || `${id}.jpg`
      let buf = await part.toBuffer()
      let ext = path.extname(originalName) || '.jpg'

      try {
        await withImageQueue(async () => {
          if (isHeic(originalName, buf)) {
            buf = await heicToJpeg(buf)
            ext = '.jpg'
          }
          const filename = `${id}${ext.toLowerCase()}`
          const dest = path.join(dir, filename)
          fs.writeFileSync(dest, buf)
          // Pass stored filename (not original HEIC name) so derivatives don't re-decode
          const prepared = await preparePhotoDerivatives(dest, filename)
          const relative = path.relative(projectDir(req.params.id), prepared.full)
          db.prepare(
            `INSERT INTO photos (id, project_id, path, original_name, category, excluded, tagged_at, created_at)
             VALUES (?, ?, ?, ?, NULL, 0, NULL, ?)`,
          ).run(
            id,
            req.params.id,
            relative,
            originalName,
            new Date().toISOString(),
          )
          created.push(id)
        })
      } catch (err) {
        req.log.error({ err, originalName }, 'photo upload failed')
        errors.push(
          `${originalName}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    touch(req.params.id)
    reply.code(201)
    return {
      uploaded: created.length,
      ids: created,
      errors: errors.length ? errors : undefined,
    }
  },
)

/** Sequentially convert HEIC + build thumbs/previews for all photos (avoids browser stampede). */
app.post<{ Params: { id: string } }>(
  '/api/projects/:id/photos/prepare',
  async (req, reply) => {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
      return reply.code(404).send({ error: 'Nie znaleziono' })
    }
    const photos = db
      .prepare('SELECT id, path, original_name FROM photos WHERE project_id = ?')
      .all(req.params.id) as { id: string; path: string; original_name: string }[]

    let done = 0
    const errors: string[] = []
    for (const photo of photos) {
      try {
        await withImageQueue(async () => {
          const abs = path.join(projectDir(req.params.id), photo.path)
          if (!fs.existsSync(abs)) {
            throw new Error('Brak pliku na dysku')
          }
          const prepared = await preparePhotoDerivatives(abs, photo.original_name)
          const relative = path.relative(projectDir(req.params.id), prepared.full)
          if (relative !== photo.path) {
            db.prepare('UPDATE photos SET path = ? WHERE id = ?').run(
              relative,
              photo.id,
            )
          }
        })
      } catch (err) {
        errors.push(
          `${photo.original_name}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      done += 1
    }
    touch(req.params.id)
    return { total: photos.length, done, errors }
  },
)

app.get<{
  Params: { id: string; photoId: string }
  Querystring: { size?: string }
}>('/api/projects/:id/photos/:photoId/file', async (req, reply) => {
  const photo = db
    .prepare('SELECT * FROM photos WHERE id = ? AND project_id = ?')
    .get(req.params.photoId, req.params.id) as
    | { id: string; path: string; original_name: string }
    | undefined
  if (!photo) return reply.code(404).send({ error: 'Nie znaleziono' })
  const abs = path.join(projectDir(req.params.id), photo.path)
  if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'Brak pliku' })

  const raw = (req.query.size || 'preview').toLowerCase()
  const size: PhotoVariant =
    raw === 'thumb' || raw === 'full' ? raw : 'preview'

  try {
    const resolved = await resolvePhotoVariant(abs, photo.original_name, size)
    if (resolved.fullPath !== abs) {
      const jpegRel = path.relative(
        projectDir(req.params.id),
        resolved.fullPath,
      )
      db.prepare('UPDATE photos SET path = ? WHERE id = ?').run(
        jpegRel,
        photo.id,
      )
    }
    reply.header('Cache-Control', 'public, max-age=86400')
    reply.type('image/jpeg')
    return reply.send(fs.createReadStream(resolved.path))
  } catch (err) {
    req.log.error(err)
    return reply.code(415).send({
      error: `Nie udało się przygotować podglądu: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
})

app.get<{ Params: { id: string } }>(
  '/api/projects/:id/background',
  async (req, reply) => {
    const project = db
      .prepare('SELECT background_path FROM projects WHERE id = ?')
      .get(req.params.id) as { background_path: string | null } | undefined
    if (!project?.background_path || !fs.existsSync(project.background_path)) {
      return reply.code(404).send({ error: 'Brak tła' })
    }
    const ext = path.extname(project.background_path).toLowerCase()
    reply.type(ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png')
    return reply.send(fs.createReadStream(project.background_path))
  },
)

app.patch<{
  Params: { id: string; photoId: string }
  Body: {
    category?: number | null
    excluded?: boolean
    partnerIds?: string[]
    tierIds?: string[]
  }
}>('/api/projects/:id/photos/:photoId', async (req, reply) => {
  const photo = db
    .prepare('SELECT * FROM photos WHERE id = ? AND project_id = ?')
    .get(req.params.photoId, req.params.id)
  if (!photo) return reply.code(404).send({ error: 'Nie znaleziono' })

  const { category, excluded, partnerIds, tierIds } = req.body
  const now = new Date().toISOString()

  if (excluded === true) {
    db.prepare(
      `UPDATE photos SET excluded = 1, category = NULL, tagged_at = ? WHERE id = ?`,
    ).run(now, req.params.photoId)
    db.prepare('DELETE FROM photo_partners WHERE photo_id = ?').run(
      req.params.photoId,
    )
    db.prepare('DELETE FROM photo_tiers WHERE photo_id = ?').run(
      req.params.photoId,
    )
  } else {
    if (category !== undefined) {
      db.prepare(
        `UPDATE photos SET category = ?, excluded = 0, tagged_at = ? WHERE id = ?`,
      ).run(category, now, req.params.photoId)
    }
    if (excluded === false) {
      db.prepare(`UPDATE photos SET excluded = 0 WHERE id = ?`).run(
        req.params.photoId,
      )
    }
    if (partnerIds !== undefined) {
      db.prepare('DELETE FROM photo_partners WHERE photo_id = ?').run(
        req.params.photoId,
      )
      const ins = db.prepare(
        'INSERT INTO photo_partners (photo_id, partner_id) VALUES (?, ?)',
      )
      for (const pid of partnerIds) ins.run(req.params.photoId, pid)
    }
    if (tierIds !== undefined) {
      db.prepare('DELETE FROM photo_tiers WHERE photo_id = ?').run(
        req.params.photoId,
      )
      const ins = db.prepare(
        'INSERT INTO photo_tiers (photo_id, tier_id) VALUES (?, ?)',
      )
      for (const tid of tierIds) ins.run(req.params.photoId, tid)
    }
    if (category !== undefined || partnerIds !== undefined || tierIds !== undefined) {
      db.prepare(`UPDATE photos SET tagged_at = ? WHERE id = ?`).run(
        now,
        req.params.photoId,
      )
    }
  }

  touch(req.params.id)
  const updated = db
    .prepare('SELECT * FROM photos WHERE id = ?')
    .get(req.params.photoId) as { id: string }
  const pIds = (
    db
      .prepare('SELECT partner_id FROM photo_partners WHERE photo_id = ?')
      .all(req.params.photoId) as { partner_id: string }[]
  ).map((r) => r.partner_id)
  const tIds = (
    db
      .prepare('SELECT tier_id FROM photo_tiers WHERE photo_id = ?')
      .all(req.params.photoId) as { tier_id: string }[]
  ).map((r) => r.tier_id)
  return { ...updated, partnerIds: pIds, tierIds: tIds }
})

app.delete<{ Params: { id: string; photoId: string } }>(
  '/api/projects/:id/photos/:photoId',
  async (req, reply) => {
    const photo = db
      .prepare('SELECT * FROM photos WHERE id = ? AND project_id = ?')
      .get(req.params.photoId, req.params.id) as { path: string } | undefined
    if (!photo) return reply.code(404).send({ error: 'Nie znaleziono' })
    db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.photoId)
    const abs = path.join(projectDir(req.params.id), photo.path)
    fs.rmSync(abs, { force: true })
    touch(req.params.id)
    return { ok: true }
  },
)

app.get<{ Params: { id: string } }>(
  '/api/projects/:id/tagging/next',
  async (req, reply) => {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
      return reply.code(404).send({ error: 'Nie znaleziono' })
    }
    const all = db
      .prepare(`SELECT * FROM photos WHERE project_id = ?`)
      .all(req.params.id) as {
      id: string
      original_name: string
      category: number | null
      excluded: number
      tagged_at: string | null
    }[]
    all.sort((a, b) =>
      a.original_name.localeCompare(b.original_name, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    )
    const untagged = all.filter((p) => p.category === null && p.excluded === 0)
    const tagged = all.length - untagged.length
    return {
      total: all.length,
      tagged,
      remaining: untagged.length,
      next: untagged[0]
        ? {
            ...untagged[0],
            partnerIds: [],
            tierIds: [],
          }
        : null,
    }
  },
)

// ——— Generate ———

app.post<{ Params: { id: string } }>(
  '/api/projects/:id/generate/start',
  async (req, reply) => {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
      return reply.code(404).send({ error: 'Nie znaleziono' })
    }
    const job = startGenerateJob(req.params.id)
    return {
      jobId: job.id,
      status: job.status,
      done: job.done,
      total: job.total,
      phase: job.phase,
      message: job.message,
    }
  },
)

app.get<{ Params: { id: string; jobId: string } }>(
  '/api/projects/:id/generate/jobs/:jobId',
  async (req, reply) => {
    const job = getJob(req.params.jobId)
    if (!job || job.projectId !== req.params.id) {
      return reply.code(404).send({ error: 'Nie znaleziono zadania' })
    }
    return {
      jobId: job.id,
      status: job.status,
      done: job.done,
      total: job.total,
      phase: job.phase,
      message: job.message,
      error: job.error,
    }
  },
)

app.get<{ Params: { id: string; jobId: string } }>(
  '/api/projects/:id/generate/jobs/:jobId/download',
  async (req, reply) => {
    const job = getJob(req.params.jobId)
    if (!job || job.projectId !== req.params.id) {
      return reply.code(404).send({ error: 'Nie znaleziono zadania' })
    }
    if (job.status !== 'done' || !job.zipPath || !fs.existsSync(job.zipPath)) {
      return reply.code(409).send({ error: 'ZIP jeszcze niegotowy' })
    }
    const buf = fs.readFileSync(job.zipPath)
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="raporty.zip"')
    return reply.send(buf)
  },
)

/** Legacy sync endpoint (kept for compatibility). Prefer /generate/start. */
app.post<{ Params: { id: string } }>(
  '/api/projects/:id/generate',
  async (req, reply) => {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) {
      return reply.code(404).send({ error: 'Nie znaleziono' })
    }
    try {
      const zipPath = await generateReportsZip(req.params.id)
      const buf = fs.readFileSync(zipPath)
      reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', 'attachment; filename="raporty.zip"')
      return reply.send(buf)
    } catch (err) {
      req.log.error(err)
      return reply.code(500).send({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
)

// Static frontend in production
const frontendDist = path.resolve(__dirname, '../../frontend/dist')
if (isProd && fs.existsSync(frontendDist)) {
  await app.register(fastifyStatic, {
    root: frontendDist,
    prefix: '/',
    wildcard: false,
  })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' })
    }
    return reply.sendFile('index.html')
  })
  console.log(`Serving frontend from ${frontendDist}`)
} else if (isProd) {
  console.warn(`Frontend dist not found at ${frontendDist} — only API available`)
}

fs.mkdirSync(DATA_DIR, { recursive: true })

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`Listening on http://localhost:${PORT}`)
