export const PHOTO_CATEGORIES = [
  { id: 1, key: 'banner', label: 'Baner konferencji', cover: true, global: true },
  { id: 4, key: 'ad_collective_live', label: 'Slajd reklamowy zbiorczy (sala)', prefersTiers: true },
  { id: 5, key: 'ad_company_live', label: 'Reklama firmy (sala)', prefersPartners: true },
  { id: 6, key: 'program_live', label: 'Program / logotypy (sala)', prefersPartners: true },
  { id: 7, key: 'ad_collective_stream', label: 'Slajd reklamowy zbiorczy (transmisja)', prefersTiers: true },
  { id: 8, key: 'ad_company_stream', label: 'Reklama firmy (transmisja)', prefersPartners: true },
  { id: 9, key: 'program_stream', label: 'Program / logotypy (transmisja)', prefersPartners: true },
  { id: 10, key: 'audience', label: 'Zdjęcia z sali', global: true },
  { id: 11, key: 'booth', label: 'Stoisko', prefersPartners: true },
  { id: 12, key: 'rollup_company', label: 'Rollup firmy', prefersPartners: true },
  { id: 13, key: 'print_folder', label: 'Folder drukowany', splitSort: true },
  { id: 14, key: 'materials', label: 'Materiały konferencyjne', splitSort: true },
  { id: 15, key: 'organizer_logo', label: 'Logotyp organizatora', cover: true, global: true },
] as const

export type PhotoCategoryId = (typeof PHOTO_CATEGORIES)[number]['id']

export type StatsLine = {
  text: string
  type: 'plain' | 'bullet'
}

export type StatsContent = {
  title: string
  lines: StatsLine[]
}

export type ProjectRow = {
  id: string
  name: string
  event_url: string
  template_path: string | null
  background_path: string | null
  stats_json: string
  created_at: string
  updated_at: string
}

export type TierRow = {
  id: string
  project_id: string
  name: string
  sort_order: number
}

export type PartnerRow = {
  id: string
  project_id: string
  tier_id: string
  name: string
}

export type PhotoRow = {
  id: string
  project_id: string
  path: string
  original_name: string
  category: number | null
  excluded: number
  tagged_at: string | null
  created_at: string
}

export function defaultStats(): StatsContent {
  return {
    title: 'Statystyki',
    lines: [{ text: 'Liczba uczestników: ', type: 'plain' }],
  }
}
