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
const progressLabel = ref('')
const progressDone = ref(0)
const progressTotal = ref(0)
const cacheKey = ref(Date.now())

const progressPct = computed(() =>
  progressTotal.value
    ? Math.round((progressDone.value / progressTotal.value) * 100)
    : 0,
)

async function load() {
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
  progressDone.value = 0
  progressTotal.value = photos.value.length
  progressLabel.value = 'Przygotowuję miniatury…'
  try {
    const res = await api.preparePhotos(id.value)
    cacheKey.value = Date.now()
    progressDone.value = res.done
    progressTotal.value = res.total
    if (res.errors?.length) {
      error.value = `Nie udało się przygotować ${res.errors.length} plików:\n${res.errors.slice(0, 10).join('\n')}${res.errors.length > 10 ? '\n…' : ''}`
    }
    progressLabel.value = `Miniatury gotowe: ${res.done}/${res.total}`
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    progressLabel.value = ''
  } finally {
    preparing.value = false
  }
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length) return

  uploading.value = true
  error.value = ''
  progressDone.value = 0
  progressTotal.value = files.length
  progressLabel.value = 'Wgrywanie zdjęć…'
  const allErrors: string[] = []
  let uploaded = 0

  // Small batches: HEIC conversion is heavy; avoids one huge request timeout
  const BATCH = 4
  try {
    for (let i = 0; i < files.length; i += BATCH) {
      const chunk = files.slice(i, i + BATCH)
      progressLabel.value = `Wgrywanie ${Math.min(i + chunk.length, files.length)}/${files.length}…`
      const res = await api.uploadPhotos(id.value, chunk)
      uploaded += res.uploaded
      progressDone.value = Math.min(i + chunk.length, files.length)
      if (res.errors?.length) allErrors.push(...res.errors)
      await load()
    }
    cacheKey.value = Date.now()
    if (allErrors.length) {
      error.value = `Dodano ${uploaded}/${files.length}. Błędy (${allErrors.length}):\n${allErrors.slice(0, 12).join('\n')}${allErrors.length > 12 ? '\n…' : ''}`
    } else {
      progressLabel.value = `Wgrano ${uploaded}/${files.length}. Przygotowuję miniatury…`
    }
    await preparePreviews()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    progressLabel.value = ''
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
const busy = computed(() => uploading.value || preparing.value)

onMounted(async () => {
  error.value = ''
  await load()
  await preparePreviews()
})
watch(id, async () => {
  error.value = ''
  progressLabel.value = ''
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
          :disabled="busy"
          @change="onFiles"
        />
      </label>
      <p class="muted" style="margin: 0; font-size: 0.85rem">
        HEIC z iPhone’a są konwertowane do JPEG przy wgrywaniu. Przy dużej liczbie plików widać postęp poniżej.
      </p>

      <div v-if="busy || progressLabel" class="progress-block">
        <div class="progress-meta">
          <span>{{ progressLabel || 'Przetwarzanie…' }}</span>
          <span v-if="progressTotal">{{ progressDone }}/{{ progressTotal }} ({{ progressPct }}%)</span>
        </div>
        <div class="progress-bar" aria-hidden="true">
          <div class="progress-fill" :style="{ width: `${progressPct}%` }" />
        </div>
      </div>

      <p>
        W bazie: <strong>{{ photos.length }}</strong>
        · otagowane: <strong>{{ tagged }}</strong> / {{ photos.length }}
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
        :disabled="!photos.length || busy"
        @click="router.push(`/projects/${id}/tagging`)"
      >
        Tagowanie →
      </button>
    </div>
  </div>
  <p v-else class="muted">Ładowanie…</p>
</template>

<style scoped>
.progress-block {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9rem;
  color: var(--muted);
}
.progress-bar {
  height: 10px;
  border-radius: 999px;
  background: #e8e2da;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
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
