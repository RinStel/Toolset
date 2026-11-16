<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Boxes, Search } from 'lucide-vue-next'

import UiEmpty from '@/shared/ui/components/UiEmpty.vue'
import UiInput from '@/shared/ui/components/UiInput.vue'

import { APP_NAME } from '../config/app'
import { groupToolsByCategory } from '../config/categories'
import { ROADMAP } from '../config/roadmap'
import { tools } from '../registry'

const query = ref('')

const normalizedQuery = computed(() => query.value.trim().toLowerCase())

const filteredTools = computed(() => {
  const needle = normalizedQuery.value
  if (!needle) return tools
  return tools.filter((tool) => {
    const haystack = [tool.title, tool.summary, ...(tool.keywords ?? [])]
    return haystack.some((value) => value.toLowerCase().includes(needle))
  })
})

const groups = computed(() => groupToolsByCategory(filteredTools.value))

const isSearching = computed(() => normalizedQuery.value.length > 0)
</script>

<template>
  <div class="home">
    <div class="home__inner">
      <header class="home__hero">
        <h1 class="home__title">{{ APP_NAME }}</h1>
        <div class="home__search">
          <Search class="home__search-icon" :size="15" aria-hidden="true" />
          <UiInput
            :model-value="query"
            type="search"
            aria-label="搜索工具"
            placeholder="搜索工具（标题、摘要、关键词）"
            data-testid="tool-search"
            @update:model-value="query = $event"
          />
        </div>
      </header>

      <div class="home__groups">
        <template v-if="groups.length > 0">
          <section
            v-for="group in groups"
            :key="group.category.key"
            class="home__group"
            :data-testid="`tool-group-${group.category.key}`"
          >
            <h2 class="home__group-title">
              <span>{{ group.category.title }}</span>
              <span class="home__group-rule" aria-hidden="true" />
            </h2>
            <div class="home__cards">
              <RouterLink
                v-for="tool in group.tools"
                :key="tool.id"
                class="tool-card"
                :to="`/tools/${tool.id}`"
                :data-testid="`tool-card-${tool.id}`"
              >
                <span class="tool-card__icon">
                  <component :is="tool.icon" :size="18" aria-hidden="true" />
                </span>
                <span class="tool-card__body">
                  <span class="tool-card__title">{{ tool.title }}</span>
                  <span class="tool-card__summary">{{ tool.summary }}</span>
                </span>
              </RouterLink>
            </div>
          </section>
        </template>
        <UiEmpty
          v-else
          :icon="isSearching ? Search : Boxes"
          eyebrow="NO RESULT"
          :title="isSearching ? '未找到匹配的工具' : '暂无可用工具'"
          :description="
            isSearching
              ? '试试其他关键词，或清空搜索框查看全部工具。'
              : '新增工具后会自动出现在这里。'
          "
        />
      </div>

      <section class="home__roadmap" aria-labelledby="home-roadmap-title">
        <h2 id="home-roadmap-title" class="home__group-title">
          <span>后续规划</span>
          <span class="home__group-rule" aria-hidden="true" />
        </h2>
        <ul class="home__roadmap-list" data-testid="roadmap">
          <li
            v-for="(item, index) in ROADMAP"
            :key="item.title"
            class="home__roadmap-item"
            data-testid="roadmap-item"
          >
            <span class="home__roadmap-index" aria-hidden="true">{{
              String(index + 1).padStart(2, '0')
            }}</span>
            <span class="home__roadmap-title">{{ item.title }}</span>
            <span class="home__roadmap-description">{{ item.description }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  overflow: auto;
  background: var(--bg);
}

.home__inner {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px var(--space-5) 40px;
}

.home__hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.home__title {
  margin: 0;
  color: var(--text);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.015em;
  line-height: 1.25;
}

.home__search {
  position: relative;
  display: flex;
  align-items: center;
  width: 320px;
  max-width: 100%;
  margin-top: 0;
}

.home__search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-faint);
  pointer-events: none;
}

.home__search :deep(.ui-input) {
  height: 32px;
  padding-left: 32px;
  border-color: var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-sunken);
  box-shadow: var(--panel-highlight);
}

.home__search :deep(.ui-input:focus) {
  border-color: var(--accent);
}

.home__groups {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.home__group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.home__group-rule {
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.home__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.tool-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elev-2);
  color: var(--text);
  text-decoration: none;
  box-shadow: var(--panel-highlight);
  transition:
    border-color 120ms ease,
    background-color 120ms ease,
    transform 120ms ease,
    box-shadow 120ms ease;
}

.tool-card:hover {
  border-color: var(--accent);
  background: var(--bg-elev-2);
  text-decoration: none;
  transform: translateY(-1px);
  box-shadow: var(--shadow-card);
}

.tool-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.tool-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 36px;
  height: 36px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent);
}

.tool-card__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.tool-card__title {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
}

.tool-card__summary {
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

.home__roadmap {
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.home__roadmap-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.home__roadmap-item {
  display: grid;
  grid-template-columns: 26px 108px minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-3);
  min-height: 30px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}

.home__roadmap-item:last-child {
  border-bottom: 0;
}

.home__roadmap-index {
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.home__roadmap-title {
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}

.home__roadmap-description {
  min-width: 0;
  color: var(--text-dim);
}

@media (max-width: 900px) {
  .home__inner {
    padding: 32px var(--space-4) 40px;
  }

  .home__title {
    font-size: 28px;
  }

  .home__roadmap-item {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .home__roadmap-description {
    grid-column: 2;
    color: var(--text-faint);
  }
}
</style>
