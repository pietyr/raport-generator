<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Category, type Photo, type Project } from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const project = ref<Project | null>(null)
const categories = ref<Category[]>([])
const current = ref<Photo | null>(null)
const total = ref(0)
const tagged = ref(0)
const remaining = ref(0)
const error = ref('')
const saving = ref(false)
const imgError = ref('')
const imgLoaded = ref(false)

const category = ref<number | null>(null)
const partnerIds = ref<string[]>([])
const tierIds = ref<string[]>([])

const previewSrc = computed(() =>
  current.value
    ? `${api.photoUrl(id.value, current.value.id, 'preview')}&t=${current.value.id}`
    : '',
)

async function loadMeta() {
  ;[project.value, categories.value] = await Promise.all([
    api.getProject(id.value),
    api.categories(),
  ])
}

async function loadNext() {
  error.value = ''
  imgError.value = ''
  imgLoaded.value = false
  const res = await api.nextUntagged(id.value)
  total.value = res.total
  tagged.value = res.tagged
  remaining.value = res.remaining
  current.value = res.next
  category.value = null
  partnerIds.value = []
  tierIds.value = []
}

function togglePartner(pid: string) {
  const i = partnerIds.value.indexOf(pid)
  if (i >= 0) partnerIds.value.splice(i, 1)
  else partnerIds.value.push(pid)
}

function toggleTier(tid: string) {
  const i = tierIds.value.indexOf(tid)
  if (i >= 0) tierIds.value.splice(i, 1)
  else tierIds.value.push(tid)
}

async function saveAndNext() {
  if (!current.value || category.value === null) {
    error.value = 'Wybierz typ zdjęcia'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await api.tagPhoto(id.value, current.value.id, {
      category: category.value,
      excluded: false,
      partnerIds: partnerIds.value,
      tierIds: tierIds.value,
    })
    await loadNext()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function skip() {
  if (!current.value) return
  saving.value = true
  error.value = ''
  try {
    await api.tagPhoto(id.value, current.value.id, { excluded: true })
    await loadNext()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await loadMeta()
  await loadNext()
})
watch(id, async () => {
  await loadMeta()
  await loadNext()
})
</script>

<template>
  <div v-if="project" class="tag-page">
    <div class="tag-head">
      <div>
        <h1>Tagowanie</h1>
        <p class="subtitle">
          Postęp: {{ tagged }} / {{ total }}
          <span v-if="remaining">· pozostało {{ remaining }}</span>
        </p>
      </div>
      <button class="btn secondary" @click="router.push(`/projects/${id}/photos`)">
        ← Zdjęcia
      </button>
    </div>

    <div v-if="current" class="tag-layout">
      <div class="viewer card">
        <p class="filename">{{ current.original_name }}</p>
        <div class="stage">
          <p v-if="!imgLoaded && !imgError" class="muted stage-msg">Ładowanie podglądu…</p>
          <p v-if="imgError" class="error stage-msg">{{ imgError }}</p>
          <img
            v-show="imgLoaded"
            class="hero"
            :src="previewSrc"
            :alt="current.original_name"
            @load="imgLoaded = true"
            @error="imgError = 'Nie udało się wczytać podglądu tego zdjęcia (możliwy uszkodzony HEIC). Możesz je pominąć.'"
          />
        </div>
      </div>

      <aside class="controls stack">
        <div class="card stack">
          <strong>Typ zdjęcia</strong>
          <div class="cats">
            <label v-for="c in categories" :key="c.id" class="cat">
              <input v-model="category" type="radio" :value="c.id" />
              <span>{{ c.id }}. {{ c.label }}</span>
            </label>
          </div>
        </div>

        <div class="card stack">
          <strong>Stopnie partnerstwa (zbiorcze)</strong>
          <div class="chips">
            <button
              v-for="t in project.tiers"
              :key="t.id"
              type="button"
              class="chip"
              :class="{ on: tierIds.includes(t.id) }"
              @click="toggleTier(t.id)"
            >
              {{ t.name }}
            </button>
          </div>
          <strong>Firmy</strong>
          <div class="chips">
            <button
              v-for="p in project.partners"
              :key="p.id"
              type="button"
              class="chip"
              :class="{ on: partnerIds.includes(p.id) }"
              @click="togglePartner(p.id)"
            >
              {{ p.name }}
            </button>
          </div>
          <p class="muted" style="margin: 0; font-size: 0.85rem">
            Bez wyboru = zdjęcie globalne (we wszystkich raportach).
          </p>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
        <div class="row">
          <button class="btn secondary" :disabled="saving" @click="skip">
            Pomiń (nie używaj)
          </button>
          <button class="btn accent" :disabled="saving" @click="saveAndNext">
            Zapisz i dalej
          </button>
        </div>
      </aside>
    </div>

    <div v-else class="card stack">
      <p class="ok" style="margin: 0">Wszystkie zdjęcia otagowane.</p>
      <button class="btn accent" @click="router.push(`/projects/${id}/generate`)">
        Przejdź do generowania →
      </button>
    </div>
  </div>
  <p v-else class="muted">Ładowanie…</p>
</template>

<style scoped>
.tag-page {
  width: min(1400px, calc(100vw - 1.5rem));
  margin: 0 auto;
}
.tag-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.tag-head h1 {
  margin-bottom: 0.2rem;
}
.tag-head .subtitle {
  margin-bottom: 0;
}
.tag-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 1rem;
  align-items: start;
}
.viewer {
  padding: 0.75rem;
}
.filename {
  margin: 0 0 0.5rem;
  color: var(--muted);
  font-size: 0.9rem;
  word-break: break-all;
}
.stage {
  position: relative;
  min-height: min(78vh, 900px);
  background: #111;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.stage-msg {
  position: absolute;
  z-index: 1;
  padding: 1rem;
  text-align: center;
}
.hero {
  display: block;
  width: 100%;
  height: min(78vh, 900px);
  object-fit: contain;
}
.controls {
  position: sticky;
  top: 4.5rem;
}
.cats {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 36vh;
  overflow: auto;
}
.cat {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  font-size: 0.92rem;
  cursor: pointer;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.chip {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.chip.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
@media (max-width: 960px) {
  .tag-layout {
    grid-template-columns: 1fr;
  }
  .controls {
    position: static;
  }
  .stage,
  .hero {
    min-height: 50vh;
    height: 50vh;
  }
}
</style>
