<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Photo, type Project } from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const project = ref<Project | null>(null)
const photos = ref<Photo[]>([])
const error = ref('')
const uploading = ref(false)
const preparing = ref(false)
const prepareNote = ref('')
/** Bust cache after prepare finishes */
const cacheKey = ref(Date.now())

async function load() {
  error.value = ''
  try {
    ;[project.value, photos.value] = await Promise.all([
      api.getProject(id.value),
      api.listPhotos(id.value),
    ])
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function preparePreviews() {
  if (!photos.value.length) return
  preparing.value = true
  prepareNote.value = 'Przygotowuję podglądy (konwersja HEIC + miniatury)… to może chwilę potrwać przy pierwszym wejściu.'
  error.value = ''
  try {
    const res = await api.preparePhotos(id.value)
    cacheKey.value = Date.now()
    if (res.errors?.length) {
      error.value = `Nie udało się przygotować ${res.errors.length} plików:\n${res.errors.slice(0, 8).join('\n')}${res.errors.length > 8 ? '\n…' : ''}`
    }
    prepareNote.value = `Gotowe: ${res.done}/${res.total}`
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    prepareNote.value = ''
  } finally {
    preparing.value = false
  }
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  uploading.value = true
  error.value = ''
  try {
    const res = await api.uploadPhotos(id.value, files)
    if (res.errors?.length) {
      error.value = `Część plików nie weszła:\n${res.errors.join('\n')}`
    }
    cacheKey.value = Date.now()
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function thumbSrc(photoId: string) {
  return `${api.photoUrl(id.value, photoId, 'thumb')}&t=${cacheKey.value}`
}

const tagged = computed(
  () => photos.value.filter((p) => p.category !== null || p.excluded === 1).length,
)

onMounted(async () => {
  await load()
  await preparePreviews()
})
watch(id, async () => {
  await load()
  await preparePreviews()
})
</script>

<template>
  <div v-if="project">
    <h1>Zdjęcia</h1>
    <p class="subtitle">
      Wrzuć wszystkie zdjęcia naraz. Kolejność w raporcie = kategoria, potem nazwa pliku.
    </p>

    <div class="card stack">
      <label class="field">
        Upload (wiele plików)
        <input
          type="file"
          accept="image/*,.heic,.heif,image/heic,image/heif"
          multiple
          @change="onFiles"
        />
      </label>
      <p class="muted" style="margin: 0; font-size: 0.85rem">
        HEIC z iPhone’a są konwertowane do JPEG; lista pokazuje lekkie miniatury.
      </p>
      <p v-if="uploading" class="muted">Wgrywanie i przygotowywanie…</p>
      <p v-if="preparing" class="muted">{{ prepareNote }}</p>
      <p v-else-if="prepareNote" class="ok">{{ prepareNote }}</p>
      <p>
        Otagowane: <strong>{{ tagged }}</strong> / {{ photos.length }}
      </p>
      <p v-if="error" class="error" style="white-space: pre-wrap">{{ error }}</p>
    </div>

    <div class="card" style="margin-top: 1rem">
      <div v-if="photos.length" class="thumbs">
        <div
          v-for="p in photos"
          :key="`${p.id}-${cacheKey}`"
          class="thumb"
          :class="{ done: p.category !== null || p.excluded === 1, skipped: p.excluded === 1 }"
        >
          <img :src="thumbSrc(p.id)" :alt="p.original_name" loading="lazy" decoding="async" />
          <div class="meta">{{ p.original_name }}</div>
        </div>
      </div>
      <p v-else class="muted">Brak zdjęć.</p>
    </div>

    <div class="row" style="margin-top: 1rem">
      <button class="btn secondary" @click="router.push(`/projects/${id}/partners`)">
        ← Partnerzy
      </button>
      <button
        class="btn accent"
        :disabled="!photos.length || preparing || uploading"
        @click="router.push(`/projects/${id}/tagging`)"
      >
        Tagowanie →
      </button>
    </div>
  </div>
  <p v-else class="muted">Ładowanie…</p>
</template>

<style scoped>
.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
}
.thumb {
  border: 2px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background: #faf8f5;
}
.thumb.done {
  border-color: var(--ok);
}
.thumb.skipped {
  border-color: var(--muted);
  opacity: 0.55;
}
.thumb img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  background: #e8e4de;
}
.meta {
  font-size: 0.7rem;
  padding: 0.35rem 0.45rem;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
