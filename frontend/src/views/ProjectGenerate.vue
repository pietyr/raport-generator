<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Project } from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const project = ref<Project | null>(null)
const error = ref('')
const generating = ref(false)
const done = ref(false)
const hasLatest = ref(false)
const latestUpdatedAt = ref<string | null>(null)
const progressDone = ref(0)
const progressTotal = ref(0)
const progressMessage = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

const progressPct = computed(() =>
  progressTotal.value
    ? Math.round((progressDone.value / progressTotal.value) * 100)
    : 0,
)

const generateButtonLabel = computed(() => {
  if (generating.value) return 'Generowanie…'
  if (hasLatest.value) return 'Wygeneruj ponownie'
  return 'Wygeneruj raporty'
})

async function loadLatest() {
  try {
    const latest = await api.latestGenerate(id.value)
    hasLatest.value = !!latest.exists
    latestUpdatedAt.value = latest.updatedAt || null
  } catch {
    hasLatest.value = false
    latestUpdatedAt.value = null
  }
}

async function load() {
  project.value = await api.getProject(id.value)
  await loadLatest()
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function triggerDownload(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${project.value?.name || 'raporty'}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadLatest() {
  error.value = ''
  try {
    const res = await fetch(api.latestGenerateDownloadUrl(id.value))
    if (!res.ok) throw new Error('Brak wygenerowanego ZIP')
    triggerDownload(await res.blob())
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function generate() {
  generating.value = true
  error.value = ''
  done.value = false
  progressDone.value = 0
  progressTotal.value = 0
  progressMessage.value = 'Uruchamianie…'
  stopPoll()

  try {
    const started = await api.startGenerate(id.value)
    progressMessage.value = started.message
    progressDone.value = started.done
    progressTotal.value = started.total

    await new Promise<void>((resolve, reject) => {
      pollTimer = setInterval(async () => {
        try {
          const st = await api.generateStatus(id.value, started.jobId)
          progressDone.value = st.done
          progressTotal.value = st.total
          progressMessage.value = st.message
          if (st.status === 'done') {
            stopPoll()
            resolve()
          } else if (st.status === 'error') {
            stopPoll()
            reject(new Error(st.error || st.message || 'Błąd generowania'))
          }
        } catch (e) {
          stopPoll()
          reject(e)
        }
      }, 800)
    })

    const res = await fetch(api.generateDownloadUrl(id.value, started.jobId))
    if (!res.ok) throw new Error('Nie udało się pobrać ZIP')
    triggerDownload(await res.blob())
    done.value = true
    progressMessage.value = 'ZIP pobrany'
    await loadLatest()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    stopPoll()
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
onUnmounted(stopPoll)
</script>

<template>
  <div v-if="project">
    <h1>Generuj raporty</h1>
    <p class="subtitle">
      ZIP ze wszystkimi firmami (PPTX + PDF). Możesz wygenerować od nowa albo pobrać ostatni ZIP.
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
        <li :class="{ ok: hasLatest }">
          Ostatni ZIP:
          <template v-if="hasLatest">
            dostępny
            <span v-if="latestUpdatedAt">
              ({{ new Date(latestUpdatedAt).toLocaleString('pl-PL') }})
            </span>
          </template>
          <template v-else>jeszcze nie wygenerowany</template>
        </li>
      </ul>

      <div v-if="generating || progressMessage" class="progress-block">
        <div class="progress-meta">
          <span>{{ progressMessage || 'Generowanie…' }}</span>
          <span v-if="progressTotal">{{ progressDone }}/{{ progressTotal }} ({{ progressPct }}%)</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${progressPct}%` }" />
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="done" class="ok">Pobieranie rozpoczęte.</p>

      <div class="row">
        <button class="btn secondary" @click="router.push(`/projects/${id}/tagging`)">
          ← Tagowanie
        </button>
        <button
          v-if="hasLatest"
          class="btn secondary"
          :disabled="generating"
          @click="downloadLatest"
        >
          Pobierz ostatni ZIP
        </button>
        <button
          class="btn accent"
          :disabled="!canGenerate || generating"
          @click="generate"
        >
          {{ generateButtonLabel }}
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
  transition: width 0.25s ease;
}
</style>
