<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
const rules = [
  {
    title: '嘉立创层叠选型',
    text: '做 90Ω/100Ω 差分高速线（USB/ETH/HDMI/MIPI）优先选 4 层 3313 压合，线宽 4–6 mil 即可达标；7628 介质较厚，相同阻抗需要更宽走线。',
  },
  {
    title: '3W / 5W / 3H 串扰间距',
    text: '规则中的倍数为中心距，净间距（边到边）分别为 2W、4W、3H。相邻差分对、晶振、时钟线建议 ≥ max(4W, 3H)。',
  },
  {
    title: '双面板做 50Ω 射频线',
    text: '1.6mm 双面板微带线做 50Ω 线宽会超过 100 mil，可切换「外层共面波导 (包地)」模式控制 S_gnd 并沿走线两侧打屏蔽地过孔。',
  },
]

const formulas = [
  '阻抗模型：外层微带采用 Hammerstad-Jensen；差分对采用 Kirschning-Jansen 奇偶模；共面波导采用 Hilberg 椭圆积分比；内层带状采用 Wadell 模型。',
  '载流与过孔：走线载流遵循 IPC-2221 / IPC-2152；过孔寄生 L/C 采用 Howard Johnson 经验公式，并联孔数包含 20% 均流安全余量。',
]
</script>

<template>
  <div class="pcb-help">
    <section class="pcb-help__section">
      <h3 class="pcb-help__heading">Layout 选型要点</h3>
      <ul class="pcb-help__list">
        <li v-for="item in rules" :key="item.title">
          <strong class="pcb-help__strong">{{ item.title }}：</strong>
          <span class="pcb-help__text">{{ item.text }}</span>
        </li>
      </ul>
    </section>

    <section class="pcb-help__section">
      <h3 class="pcb-help__heading">计算标准</h3>
      <ul class="pcb-help__list">
        <li v-for="item in formulas" :key="item" class="pcb-help__text">• {{ item }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.pcb-help {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.pcb-help__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.pcb-help__section + .pcb-help__section {
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}

.pcb-help__heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.pcb-help__heading::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.pcb-help__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pcb-help__strong {
  color: var(--text);
  font-weight: 600;
  font-size: 11px;
}

.pcb-help__text {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
}
</style>
