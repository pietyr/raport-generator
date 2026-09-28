import { randomUUID } from 'node:crypto'
import type { GenerateProgress } from './generate.js'
import { generateReportsZip } from './generate.js'

export type GenerateJob = {
  id: string
  projectId: string
  status: 'running' | 'done' | 'error'
  done: number
  total: number
  phase: string
  message: string
  error?: string
  zipPath?: string
  createdAt: number
}

const jobs = new Map<string, GenerateJob>()

export function getJob(jobId: string) {
  return jobs.get(jobId)
}

export function startGenerateJob(projectId: string): GenerateJob {
  const id = randomUUID()
  const job: GenerateJob = {
    id,
    projectId,
    status: 'running',
    done: 0,
    total: 0,
    phase: 'start',
    message: 'Uruchamianie…',
    createdAt: Date.now(),
  }
  jobs.set(id, job)

  void (async () => {
    try {
      const zipPath = await generateReportsZip(projectId, (p: GenerateProgress) => {
        job.done = p.done
        job.total = p.total
        job.phase = p.phase
        job.message = p.message
      })
      job.zipPath = zipPath
      job.status = 'done'
      job.phase = 'done'
      job.message = 'Gotowe — możesz pobrać ZIP'
      job.done = job.total
    } catch (err) {
      job.status = 'error'
      job.phase = 'error'
      job.error = err instanceof Error ? err.message : String(err)
      job.message = job.error
    }
  })()

  // Cleanup old jobs after 2h
  for (const [jid, j] of jobs) {
    if (Date.now() - j.createdAt > 2 * 60 * 60 * 1000) jobs.delete(jid)
  }

  return job
}
