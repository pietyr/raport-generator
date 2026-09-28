export type StatsLine = { text: string; type: 'plain' | 'bullet' }
export type StatsContent = { title: string; lines: StatsLine[] }

export type Tier = { id: string; project_id: string; name: string; sort_order: number }
export type Partner = { id: string; project_id: string; tier_id: string; name: string }

export type Project = {
  id: string
  name: string
  event_url: string
  template_path: string | null
  background_path: string | null
  stats: StatsContent
  tiers: Tier[]
  partners: Partner[]
  photo_total: number
  photo_tagged: number
  created_at: string
  updated_at: string
}

export type ProjectListItem = {
  id: string
  name: string
  event_url: string
  photo_count: number
  tagged_count: number
  partner_count: number
  updated_at: string
  stats: StatsContent
}

export type Photo = {
  id: string
  project_id: string
  path: string
  original_name: string
  category: number | null
  excluded: number
  tagged_at: string | null
  partnerIds: string[]
  tierIds: string[]
}

export type Category = {
  id: number
  key: string
  label: string
  cover?: boolean
  global?: boolean
  prefersTiers?: boolean
  prefersPartners?: boolean
  splitSort?: boolean
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      msg = body.error || msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return res as unknown as T
}

export const api = {
  listProjects: () => request<ProjectListItem[]>('/api/projects'),
  createProject: (name: string) =>
    request<Project>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  updateProject: (
    id: string,
    data: Partial<{ name: string; event_url: string; stats: StatsContent }>,
  ) =>
    request<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  uploadTemplate: async (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<Project>(`/api/projects/${id}/template`, {
      method: 'POST',
      body: fd,
    })
  },
  addTier: (id: string, name: string) =>
    request<Project>(`/api/projects/${id}/tiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  updateTier: (id: string, tierId: string, data: { name?: string; sort_order?: number }) =>
    request<Project>(`/api/projects/${id}/tiers/${tierId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteTier: (id: string, tierId: string) =>
    request<Project>(`/api/projects/${id}/tiers/${tierId}`, { method: 'DELETE' }),
  reorderTiers: (id: string, order: string[]) =>
    request<Project>(`/api/projects/${id}/tiers/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    }),
  addPartner: (id: string, name: string, tier_id: string) =>
    request<Project>(`/api/projects/${id}/partners-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tier_id }),
    }),
  updatePartner: (
    id: string,
    partnerId: string,
    data: { name?: string; tier_id?: string },
  ) =>
    request<Project>(`/api/projects/${id}/partners-item/${partnerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deletePartner: (id: string, partnerId: string) =>
    request<Project>(`/api/projects/${id}/partners-item/${partnerId}`, {
      method: 'DELETE',
    }),
  listPhotos: (id: string) => request<Photo[]>(`/api/projects/${id}/photos`),
  uploadPhotos: async (id: string, files: FileList | File[]) => {
    const fd = new FormData()
    for (const f of Array.from(files)) fd.append('files', f)
    return request<{ uploaded: number }>(`/api/projects/${id}/photos`, {
      method: 'POST',
      body: fd,
    })
  },
  tagPhoto: (
    id: string,
    photoId: string,
    data: {
      category?: number | null
      excluded?: boolean
      partnerIds?: string[]
      tierIds?: string[]
    },
  ) =>
    request<Photo>(`/api/projects/${id}/photos/${photoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  nextUntagged: (id: string) =>
    request<{
      total: number
      tagged: number
      remaining: number
      next: Photo | null
    }>(`/api/projects/${id}/tagging/next`),
  categories: () => request<Category[]>('/api/categories'),
  photoUrl: (projectId: string, photoId: string) =>
    `/api/projects/${projectId}/photos/${photoId}/file`,
  backgroundUrl: (projectId: string) => `/api/projects/${projectId}/background`,
  generate: async (id: string) => {
    const res = await fetch(`/api/projects/${id}/generate`, { method: 'POST' })
    if (!res.ok) {
      let msg = res.statusText
      try {
        const body = await res.json()
        msg = body.error || msg
      } catch {
        /* ignore */
      }
      throw new Error(msg)
    }
    return res.blob()
  },
}
