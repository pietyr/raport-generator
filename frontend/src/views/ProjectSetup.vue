<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Project, type StatsContent, type StatsLine } from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const project = ref<Project | null>(null)
const error = ref('')
const saving = ref(false)
const uploading = ref(false)
const name = ref('')
const eventUrl = ref('')
const stats = ref<StatsContent>({ title: 'Statystyki', lines: [] })

const bgUrl = computed(() =>
  project.value?.background_path
    ? `${api.backgroundUrl(id.value)}?t=${project.value.updated_at}`
    : null,
)

async function load() {
  error.value = ''
  try {
    project.value = await api.getProject(id.value)
    name.value = project.value.name
    eventUrl.value = project.value.event_url
    stats.value = structuredClone(project.value.stats)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    project.value = await api.updateProject(id.value, {
      name: name.value,
      event_url: eventUrl.value,
      stats: stats.value,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function onTemplate(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  error.value = ''
  try {
    project.value = await api.uploadTemplate(id.value, file)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    uploading.value = false
    input.value = ''
  }
}

function addLine(type: StatsLine['type'] = 'plain') {
  stats.value.lines.push({ text: '', type })
}

function removeLine(i: number) {
  stats.value.lines.splice(i, 1)
}

onMounted(load)
watch(id, load)
</script>

<template>
  <div v-if="project">
    <h1>{{ project.name }}</h1>
    <p class="subtitle">Szablon, link i statystyki</p>

    <div class="grid-2">
      <div class="stack">
        <div class="card stack">
          <label class="field">
            Nazwa projektu
            <input v-model="name" type="text" />
          </label>
          <label class="field">
            Link do strony wydarzenia
            <input v-model="eventUrl" type="url" placeholder="https://…" />
          </label>
          <label class="field">
            Szablon PPTX konferencji
            <input type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" @change="onTemplate" />
          </label>
          <p v-if="project.background_path" class="ok">Tło slajdów treści wyodrębnione z szablonu.</p>
          <p v-else class="muted">Wgraj szablon — użyjemy tła layoutu treści (nie slajdu tytułowego).</p>
          <p v-if="uploading" class="muted">Przetwarzanie szablonu…</p>
        </div>

        <div class="card stack">
          <label class="field">
            Nagłówek statystyk
            <input v-model="stats.title" type="text" />
          </label>
          <div v-for="(line, i) in stats.lines" :key="i" class="row">
            <select v-model="line.type" style="width: 8rem">
              <option value="plain">Wiersz</option>
              <option value="bullet">Punkt listy</option>
            </select>
            <input v-model="line.text" type="text" style="flex: 1" placeholder="Treść…" />
            <button class="btn ghost" type="button" @click="removeLine(i)">×</button>
          </div>
          <div class="row">
            <button class="btn secondary" type="button" @click="addLine('plain')">+ Wiersz</button>
            <button class="btn secondary" type="button" @click="addLine('bullet')">+ Punkt</button>
          </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <div class="row">
          <button class="btn accent" :disabled="saving" @click="save">Zapisz</button>
          <button class="btn secondary" @click="router.push(`/projects/${id}/partners`)">
            Dalej: partnerzy →
          </button>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <p class="muted" style="margin-top: 0">1. Strona wydarzenia</p>
          <div class="preview" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}">
            <div class="preview-title">Strona wydarzenia</div>
            <div class="preview-link">{{ eventUrl || 'https://…' }}</div>
          </div>
        </div>
        <div class="card">
          <p class="muted" style="margin-top: 0">2. Statystyki</p>
          <div class="preview" :style="bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}">
            <div class="preview-title">{{ stats.title || 'Statystyki' }}</div>
            <ul class="preview-body">
              <li
                v-for="(line, i) in stats.lines"
                :key="i"
                :class="{ bullet: line.type === 'bullet', plain: line.type === 'plain' }"
              >
                {{ line.text || '…' }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>
  <p v-else-if="error" class="error">{{ error }}</p>
  <p v-else class="muted">Ładowanie…</p>
</template>

<style scoped>
.preview {
  aspect-ratio: 16 / 9;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff center / cover no-repeat;
  padding: 8% 7% 6%;
  position: relative;
  overflow: hidden;
}
.preview-title {
  font-size: clamp(0.9rem, 2.2vw, 1.25rem);
  font-weight: 700;
  margin-bottom: 0.75rem;
  color: #333;
}
.preview-body {
  margin: 0;
  padding: 0;
  list-style: none;
  color: #333;
  font-size: clamp(0.7rem, 1.5vw, 0.95rem);
}
.preview-body li.bullet {
  list-style: disc;
  margin-left: 1.2rem;
  display: list-item;
}
.preview-body li.plain {
  margin-bottom: 0.25rem;
}
.preview-link {
  color: #0563c1;
  font-size: clamp(0.65rem, 1.4vw, 0.9rem);
  word-break: break-all;
}
</style>
