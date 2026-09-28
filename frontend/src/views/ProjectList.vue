<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, type ProjectListItem } from '../api'

const router = useRouter()
const projects = ref<ProjectListItem[]>([])
const loading = ref(true)
const error = ref('')
const creating = ref(false)
const newName = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    projects.value = await api.listProjects()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function create() {
  creating.value = true
  error.value = ''
  try {
    const p = await api.createProject(newName.value || 'Nowa konferencja')
    newName.value = ''
    await router.push(`/projects/${p.id}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

async function remove(id: string, name: string) {
  if (!confirm(`Usunąć projekt „${name}”?`)) return
  await api.deleteProject(id)
  await load()
}

onMounted(load)
</script>

<template>
  <div>
    <h1>Projekty</h1>
    <p class="subtitle">Konferencje i raporty partnerskie</p>

    <div class="card stack">
      <div class="row">
        <label class="field" style="flex: 1">
          Nazwa konferencji
          <input v-model="newName" type="text" placeholder="np. Wschód Onkologii 2026" @keyup.enter="create" />
        </label>
        <button class="btn accent" :disabled="creating" @click="create">
          Nowy projekt
        </button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div class="card" style="margin-top: 1rem">
      <p v-if="loading" class="muted">Ładowanie…</p>
      <ul v-else-if="projects.length" class="list">
        <li v-for="p in projects" :key="p.id">
          <div>
            <strong>
              <RouterLink :to="`/projects/${p.id}`">{{ p.name }}</RouterLink>
            </strong>
            <div class="muted" style="font-size: 0.85rem; margin-top: 0.2rem">
              Partnerzy: {{ p.partner_count }} · Zdjęcia: {{ p.tagged_count }}/{{ p.photo_count }}
              · {{ new Date(p.updated_at).toLocaleString('pl-PL') }}
            </div>
          </div>
          <div class="row">
            <RouterLink class="btn secondary" :to="`/projects/${p.id}`">Otwórz</RouterLink>
            <button class="btn ghost" @click="remove(p.id, p.name)">Usuń</button>
          </div>
        </li>
      </ul>
      <p v-else class="muted">Brak projektów — utwórz pierwszy.</p>
    </div>
  </div>
</template>
