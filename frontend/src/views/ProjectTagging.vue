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

const category = ref<number | null>(null)
const partnerIds = ref<string[]>([])
const tierIds = ref<string[]>([])

async function loadMeta() {
  ;[project.value, categories.value] = await Promise.all([
    api.getProject(id.value),
    api.categories(),
  ])
}

async function loadNext() {
  error.value = ''
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
  <div v-if="project">
    <h1>Tagowanie</h1>
    <p class="subtitle">
      Postęp: {{ tagged }} / {{ total }}
      <span v-if="remaining">· pozostało {{ remaining }}</span>
    </p>

    <div v-if="current" class="grid-2">
      <div class="card">
        <img
          class="big"
          :src="api.photoUrl(id, current.id)"
          :alt="current.original_name"
        />
        <p class="muted" style="margin-bottom: 0">{{ current.original_name }}</p>
      </div>

      <div class="stack">
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
            Bez wyboru = zdjęcie globalne (we wszystkich raportach). Możesz wybrać firmy i/lub całe stopnie.
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
      </div>
    </div>

    <div v-else class="card stack">
      <p class="ok" style="margin: 0">Wszystkie zdjęcia otagowane.</p>
      <button class="btn accent" @click="router.push(`/projects/${id}/generate`)">
        Przejdź do generowania →
      </button>
    </div>

    <div class="row" style="margin-top: 1rem">
      <button class="btn secondary" @click="router.push(`/projects/${id}/photos`)">← Zdjęcia</button>
    </div>
  </div>
  <p v-else class="muted">Ładowanie…</p>
</template>

<style scoped>
.big {
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
  background: #111;
  border-radius: 8px;
}
.cats {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 280px;
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
</style>
