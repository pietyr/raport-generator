import { createRouter, createWebHistory } from 'vue-router'
import ProjectList from './views/ProjectList.vue'
import ProjectSetup from './views/ProjectSetup.vue'
import ProjectPartners from './views/ProjectPartners.vue'
import ProjectPhotos from './views/ProjectPhotos.vue'
import ProjectTagging from './views/ProjectTagging.vue'
import ProjectGenerate from './views/ProjectGenerate.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: ProjectList },
    { path: '/projects/:id', name: 'setup', component: ProjectSetup },
    { path: '/projects/:id/partners', name: 'partners', component: ProjectPartners },
    { path: '/projects/:id/photos', name: 'photos', component: ProjectPhotos },
    { path: '/projects/:id/tagging', name: 'tagging', component: ProjectTagging },
    { path: '/projects/:id/generate', name: 'generate', component: ProjectGenerate },
  ],
})

export default router
