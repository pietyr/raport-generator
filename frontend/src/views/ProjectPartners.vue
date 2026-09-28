<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type Project } from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const project = ref<Project | null>(null)
const error = ref('')
const tierName = ref('')
const partnerName = ref('')
const partnerTierId = ref('')

async function load() {
  error.value = ''
  try {
    project.value = await api.getProject(id.value)
    if (!partnerTierId.value && project.value.tiers[0]) {
      partnerTierId.value = project.value.tiers[0].id
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function addTier() {
  if (!tierName.value.trim()) return
  project.value = await api.addTier(id.value, tierName.value.trim())
  tierName.value = ''
  if (!partnerTierId.value && project.value.tiers[0]) {
    partnerTierId.value = project.value.tiers[0].id
  }
}

async function renameTier(tierId: string, name: string) {
  project.value = await api.updateTier(id.value, tierId, { name })
}

async function removeTier(tierId: string) {
  if (!confirm('Usunąć stopień i firmy w nim?')) return
  project.value = await api.deleteTier(id.value, tierId)
}

async function moveTier(tierId: string, dir: -1 | 1) {
  if (!project.value) return
  const order = project.value.tiers.map((t) => t.id)
  const i = order.indexOf(tierId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return
  ;[order[i], order[j]] = [order[j], order[i]]
  project.value = await api.reorderTiers(id.value, order)
}

async function addPartner() {
  if (!partnerName.value.trim() || !partnerTierId.value) return
  project.value = await api.addPartner(
    id.value,
    partnerName.value.trim(),
    partnerTierId.value,
  )
  partnerName.value = ''
}

async function renamePartner(partnerId: string, name: string) {
  project.value = await api.updatePartner(id.value, partnerId, { name })
}

async function changePartnerTier(partnerId: string, tier_id: string) {
  project.value = await api.updatePartner(id.value, partnerId, { tier_id })
}

async function removePartner(partnerId: string) {
  if (!confirm('Usunąć firmę?')) return
  project.value = await api.deletePartner(id.value, partnerId)
}

function partnersInTier(tierId: string) {
  return project.value?.partners.filter((p) => p.tier_id === tierId) ?? []
}

onMounted(load)
watch(id, load)
</script>

<template>
  <div v-if="project">
    <h1>Partnerzy</h1>
    <p class="subtitle">
      Stopnie od najwyższego (kolejność = ranking). Następnie firmy w stopniach.
    </p>

    <div class="card stack">
      <h3 style="margin: 0">Stopnie partnerstwa</h3>
      <div class="row">
        <input
          v-model="tierName"
          type="text"
          placeholder="np. Partner strategiczny"
          style="flex: 1"
          @keyup.enter="addTier"
        />
        <button class="btn accent" @click="addTier">Dodaj stopień</button>
      </div>
      <ul class="list">
        <li v-for="(t, idx) in project.tiers" :key="t.id">
          <div class="row" style="flex: 1">
            <span class="badge">{{ idx + 1 }}</span>
            <input
              :value="t.name"
              type="text"
              style="flex: 1"
              @change="renameTier(t.id, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="row">
            <button class="btn ghost" :disabled="idx === 0" @click="moveTier(t.id, -1)">↑</button>
            <button
              class="btn ghost"
              :disabled="idx === project.tiers.length - 1"
              @click="moveTier(t.id, 1)"
            >
              ↓
            </button>
            <button class="btn ghost" @click="removeTier(t.id)">Usuń</button>
          </div>
        </li>
      </ul>
      <p v-if="!project.tiers.length" class="muted">Dodaj przynajmniej jeden stopień.</p>
    </div>

    <div class="card stack" style="margin-top: 1rem">
      <h3 style="margin: 0">Firmy</h3>
      <div class="row">
        <select v-model="partnerTierId" style="min-width: 12rem" :disabled="!project.tiers.length">
          <option v-for="t in project.tiers" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <input
          v-model="partnerName"
          type="text"
          placeholder="Nazwa firmy"
          style="flex: 1"
          :disabled="!project.tiers.length"
          @keyup.enter="addPartner"
        />
        <button class="btn accent" :disabled="!project.tiers.length" @click="addPartner">
          Dodaj firmę
        </button>
      </div>

      <div v-for="t in project.tiers" :key="t.id" class="tier-block">
        <h4>{{ t.name }}</h4>
        <ul class="list">
          <li v-for="p in partnersInTier(t.id)" :key="p.id">
            <div class="row" style="flex: 1">
              <input
                :value="p.name"
                type="text"
                style="flex: 1"
                @change="renamePartner(p.id, ($event.target as HTMLInputElement).value)"
              />
              <select
                :value="p.tier_id"
                @change="changePartnerTier(p.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="tt in project.tiers" :key="tt.id" :value="tt.id">
                  {{ tt.name }}
                </option>
              </select>
            </div>
            <button class="btn ghost" @click="removePartner(p.id)">Usuń</button>
          </li>
        </ul>
        <p v-if="!partnersInTier(t.id).length" class="muted">Brak firm w tym stopniu.</p>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="row" style="margin-top: 1rem">
      <button class="btn secondary" @click="router.push(`/projects/${id}`)">← Setup</button>
      <button class="btn secondary" @click="router.push(`/projects/${id}/photos`)">
        Dalej: zdjęcia →
      </button>
    </div>
  </div>
  <p v-else class="muted">Ładowanie…</p>
</template>

<style scoped>
.tier-block {
  border-top: 1px solid var(--line);
  padding-top: 0.75rem;
}
.tier-block h4 {
  margin: 0 0 0.35rem;
  color: var(--accent);
}
</style>
