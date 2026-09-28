<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const projectId = computed(() => (route.params.id as string) || null)

const steps = computed(() => {
  if (!projectId.value) return []
  const id = projectId.value
  return [
    { to: `/projects/${id}`, label: 'Setup', exact: true },
    { to: `/projects/${id}/partners`, label: 'Partnerzy', exact: true },
    { to: `/projects/${id}/photos`, label: 'Zdjęcia', exact: true },
    { to: `/projects/${id}/tagging`, label: 'Tagowanie', exact: true },
    { to: `/projects/${id}/generate`, label: 'Generuj', exact: true },
  ]
})

function isActive(to: string, exact: boolean) {
  return exact ? route.path === to : route.path.startsWith(to)
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <RouterLink to="/" class="brand">Raporty konferencyjne</RouterLink>
      <nav v-if="steps.length" class="steps">
        <RouterLink
          v-for="s in steps"
          :key="s.to"
          :to="s.to"
          class="step"
          :class="{ active: isActive(s.to, s.exact) }"
        >
          {{ s.label }}
        </RouterLink>
      </nav>
    </header>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
