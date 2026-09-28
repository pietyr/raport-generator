<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Project } from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const project = ref<Project | null>(null)
const error = ref('')
const generating = ref(false)
const done = ref(false)

async function load() {
  project.value = await api.getProject(id.value)
}

async function generate() {
  generating.value = true
  error.value = ''
  done.value = false
  try {
    const blob = await api.generate(id.value)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.value?.name || 'raporty'}.zip`
    a.click()
    URL.revokeObjectURL(url)
    done.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    generating.value = false
  }
}

const canGenerate = computed(
  () =>
    !!project.value &&
    project.value.partners.length > 0 &&
    !!project.value.background_path,
)

onMounted(load)
watch(id, load)
</script>

<template>
  <div v-if="project">
    <h1>Generuj raporty</h1>
    <p class="subtitle">
      Jeden ZIP ze wszystkimi firmami (PPTX + PDF). Brak LibreOffice = tylko PPTX + plik z błędami PDF.
    </p>

    <div class="card stack">
      <ul class="checklist">
        <li :class="{ ok: !!project.background_path }">
          Szablon / tło:
          {{ project.background_path ? 'OK' : 'brak — wróć do setupu' }}
        </li>
        <li :class="{ ok: project.partners.length > 0 }">
          Partnerzy: {{ project.partners.length }}
        </li>
        <li :class="{ ok: project.photo_tagged > 0 }">
          Otagowane zdjęcia: {{ project.photo_tagged }} / {{ project.photo_total }}
        </li>
        <li :class="{ ok: !!project.event_url }">
          URL wydarzenia: {{ project.event_url || 'pusty' }}
        </li>
      </ul>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="done" class="ok">Pobieranie rozpoczęte.</p>

      <div class="row">
        <button class="btn secondary" @click="router.push(`/projects/${id}/tagging`)">
          ← Tagowanie
        </button>
        <button
          class="btn accent"
          :disabled="!canGenerate || generating"
          @click="generate"
        >
          {{ generating ? 'Generowanie…' : 'Pobierz ZIP raportów' }}
        </button>
      </div>
    </div>
  </div>
  <p v-else class="muted">Ładowanie…</p>
</template>

<style scoped>
.checklist {
  margin: 0;
  padding-left: 1.2rem;
}
.checklist li {
  margin: 0.35rem 0;
  color: var(--muted);
}
.checklist li.ok {
  color: var(--ok);
}
</style>
