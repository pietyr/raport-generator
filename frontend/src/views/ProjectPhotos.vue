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

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  uploading.value = true
  error.value = ''
  try {
    await api.uploadPhotos(id.value, files)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    uploading.value = false
    input.value = ''
  }
}

const tagged = computed(
  () => photos.value.filter((p) => p.category !== null || p.excluded === 1).length,
)

onMounted(load)
watch(id, load)
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
          accept="image/*"
          multiple
          @change="onFiles"
        />
      </label>
      <p v-if="uploading" class="muted">Wgrywanie…</p>
      <p>
        Otagowane: <strong>{{ tagged }}</strong> / {{ photos.length }}
      </p>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div class="card" style="margin-top: 1rem">
      <div v-if="photos.length" class="thumbs">
        <div
          v-for="p in photos"
          :key="p.id"
          class="thumb"
          :class="{ done: p.category !== null || p.excluded === 1, skipped: p.excluded === 1 }"
        >
          <img :src="api.photoUrl(id, p.id)" :alt="p.original_name" loading="lazy" />
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
        :disabled="!photos.length"
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
