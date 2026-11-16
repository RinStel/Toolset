<script setup lang="ts">
import { computed } from 'vue'

import { formatLength, type LengthUnit, type TransmissionLineMode } from '../core/presets'

const props = withDefaults(
  defineProps<{
    kind: TransmissionLineMode | 'via'
    unit: LengthUnit
    wMil?: number
    sMil?: number
    sGndMil?: number
    hMil?: number
    h2Mil?: number
    tMil?: number
    er?: number
    holeDiaMm?: number
    padDiaMm?: number
    antiPadDiaMm?: number
    boardThicknessMm?: number
    platingUm?: number
    refLabel?: string
    refAboveLabel?: string
    refBelowLabel?: string
  }>(),
  {
    wMil: 5,
    sMil: 6,
    sGndMil: 8,
    hMil: 3.94,
    h2Mil: 21.65,
    tMil: 1.378,
    er: 4.05,
    holeDiaMm: 0.3,
    padDiaMm: 0.6,
    antiPadDiaMm: 0.9,
    boardThicknessMm: 1.6,
    platingUm: 20,
    refLabel: 'L2 参考平面',
    refAboveLabel: 'L2 参考平面',
    refBelowLabel: 'L4 参考平面',
  },
)

const wText = computed(() => `W = ${formatLength(props.wMil, props.unit)}`)
const sText = computed(() => `S = ${formatLength(props.sMil, props.unit)}`)
const sGndText = computed(() => `S_gnd = ${formatLength(props.sGndMil, props.unit)}`)
const hText = computed(() => `H = ${formatLength(props.hMil, props.unit)}`)
const h1Text = computed(() => `H1 = ${formatLength(props.hMil, props.unit)}`)
const h2Text = computed(() => `H2 = ${formatLength(props.h2Mil, props.unit)}`)
const tText = computed(() => `T = ${formatLength(props.tMil, props.unit)}`)
const erText = computed(() => `Dk = ${props.er.toFixed(2)}`)
</script>

<template>
  <svg
    class="pcb-svg"
    viewBox="0 0 480 192"
    role="img"
    :aria-label="`PCB ${kind} 截面尺寸示意图`"
    data-testid="pcb-cross-section-svg"
  >
    <defs>
      <pattern id="pcb-dielectric-hatch" width="8" height="8" patternUnits="userSpaceOnUse">
        <path
          d="M 0 8 L 8 0 M -2 2 L 2 -2 M 6 10 L 10 6"
          stroke="var(--border)"
          stroke-width="0.7"
          opacity="0.55"
        />
      </pattern>
      <marker
        id="pcb-arrow"
        viewBox="0 0 6 6"
        refX="3"
        refY="3"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M 0 1 L 6 3 L 0 5 z" fill="var(--text-dim)" />
      </marker>
    </defs>

    <!-- 背景 -->
    <rect x="0" y="0" width="480" height="192" fill="var(--bg-sunken)" rx="4" />

    <!-- 1. 外层单端微带线 -->
    <template v-if="kind === 'microstrip'">
      <path
        d="M 40 84 L 185 84 L 190 64 L 290 64 L 295 84 L 440 84 L 440 92 L 40 92 Z"
        fill="var(--ok-soft)"
        stroke="var(--ok)"
        stroke-width="1"
        opacity="0.7"
      />
      <rect x="40" y="92" width="400" height="58" fill="url(#pcb-dielectric-hatch)" />
      <rect
        x="40"
        y="92"
        width="400"
        height="58"
        fill="none"
        stroke="var(--border-strong)"
        stroke-width="1"
      />
      <rect x="195" y="74" width="90" height="18" fill="var(--warn)" rx="1" />
      <rect x="40" y="150" width="400" height="16" fill="var(--accent)" opacity="0.85" />

      <!-- W 标注 -->
      <line
        x1="195"
        y1="38"
        x2="285"
        y2="38"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <line
        x1="195"
        y1="34"
        x2="195"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <line
        x1="285"
        y1="34"
        x2="285"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <text x="240" y="28" text-anchor="middle" class="svg-label-accent">{{ wText }}</text>

      <!-- H / Dk / T -->
      <line
        x1="78"
        y1="94"
        x2="78"
        y2="148"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="88" y="125" class="svg-label svg-halo">{{ hText }}</text>
      <text x="415" y="125" text-anchor="end" class="svg-label svg-halo">{{ erText }}</text>
      <text x="415" y="72" text-anchor="end" class="svg-label-dim svg-halo">{{ tText }}</text>
      <text x="240" y="162" text-anchor="middle" class="svg-gnd">{{ refLabel }}</text>
    </template>

    <!-- 2. 外层差分微带线 -->
    <template v-else-if="kind === 'diff-microstrip'">
      <rect x="40" y="92" width="400" height="58" fill="url(#pcb-dielectric-hatch)" />
      <rect
        x="40"
        y="92"
        width="400"
        height="58"
        fill="none"
        stroke="var(--border-strong)"
        stroke-width="1"
      />
      <rect x="40" y="85" width="400" height="7" fill="var(--ok-soft)" />
      <rect x="145" y="74" width="70" height="18" fill="var(--warn)" rx="1" />
      <rect x="265" y="74" width="70" height="18" fill="var(--warn)" rx="1" />
      <text x="180" y="87" text-anchor="middle" class="svg-inner-dark">D+</text>
      <text x="300" y="87" text-anchor="middle" class="svg-inner-dark">D-</text>
      <rect x="40" y="150" width="400" height="16" fill="var(--accent)" opacity="0.85" />

      <!-- W 标注（在左线正上方，充足垂直间距） -->
      <line
        x1="145"
        y1="32"
        x2="215"
        y2="32"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <line
        x1="145"
        y1="28"
        x2="145"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <line
        x1="215"
        y1="28"
        x2="215"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <text x="180" y="22" text-anchor="middle" class="svg-label-accent">{{ wText }}</text>

      <!-- S 标注（位于走线间隙上方，且低于 W 标线 28px 以上） -->
      <line
        x1="215"
        y1="62"
        x2="265"
        y2="62"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="240" y="53" text-anchor="middle" class="svg-label-accent svg-halo">{{ sText }}</text>

      <!-- H / Dk -->
      <line
        x1="78"
        y1="94"
        x2="78"
        y2="148"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="88" y="125" class="svg-label svg-halo">{{ hText }}</text>
      <text x="415" y="125" text-anchor="end" class="svg-label svg-halo">
        {{ erText }} · {{ tText }}
      </text>
      <text x="240" y="162" text-anchor="middle" class="svg-gnd">{{ refLabel }}</text>
    </template>

    <!-- 3. 外层单端共面波导 (包地) -->
    <template v-else-if="kind === 'cpwg'">
      <rect x="40" y="92" width="400" height="58" fill="url(#pcb-dielectric-hatch)" />
      <rect
        x="40"
        y="92"
        width="400"
        height="58"
        fill="none"
        stroke="var(--border-strong)"
        stroke-width="1"
      />
      <rect x="40" y="74" width="115" height="18" fill="var(--accent)" opacity="0.75" rx="1" />
      <rect x="325" y="74" width="115" height="18" fill="var(--accent)" opacity="0.75" rx="1" />
      <text x="97" y="87" text-anchor="middle" class="svg-gnd">包地 GND</text>
      <text x="382" y="87" text-anchor="middle" class="svg-gnd">包地 GND</text>
      <rect x="200" y="74" width="80" height="18" fill="var(--warn)" rx="1" />
      <rect x="40" y="150" width="400" height="16" fill="var(--accent)" opacity="0.85" />

      <!-- W 标注 -->
      <line
        x1="200"
        y1="34"
        x2="280"
        y2="34"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <line
        x1="200"
        y1="30"
        x2="200"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <line
        x1="280"
        y1="30"
        x2="280"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <text x="240" y="24" text-anchor="middle" class="svg-label-accent">{{ wText }}</text>

      <!-- S_gnd 标注：文字左移到左包地铜皮上方，远离中间 W 区域 -->
      <line
        x1="155"
        y1="62"
        x2="200"
        y2="62"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="150" y="54" text-anchor="end" class="svg-label svg-halo">{{ sGndText }}</text>

      <!-- H / Dk -->
      <line
        x1="78"
        y1="94"
        x2="78"
        y2="148"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="88" y="125" class="svg-label svg-halo">{{ hText }}</text>
      <text x="415" y="125" text-anchor="end" class="svg-label svg-halo">{{ erText }}</text>
      <text x="240" y="162" text-anchor="middle" class="svg-gnd">{{ refLabel }}</text>
    </template>

    <!-- 3.5 外层差分共面波导 (包地) -->
    <template v-else-if="kind === 'diff-cpwg'">
      <rect x="40" y="92" width="400" height="58" fill="url(#pcb-dielectric-hatch)" />
      <rect
        x="40"
        y="92"
        width="400"
        height="58"
        fill="none"
        stroke="var(--border-strong)"
        stroke-width="1"
      />
      <rect x="40" y="74" width="85" height="18" fill="var(--accent)" opacity="0.75" rx="1" />
      <rect x="355" y="74" width="85" height="18" fill="var(--accent)" opacity="0.75" rx="1" />
      <text x="82" y="87" text-anchor="middle" class="svg-gnd">包地 GND</text>
      <text x="397" y="87" text-anchor="middle" class="svg-gnd">包地 GND</text>
      <rect x="165" y="74" width="56" height="18" fill="var(--warn)" rx="1" />
      <rect x="259" y="74" width="56" height="18" fill="var(--warn)" rx="1" />
      <text x="193" y="87" text-anchor="middle" class="svg-inner-dark">D+</text>
      <text x="287" y="87" text-anchor="middle" class="svg-inner-dark">D-</text>
      <rect x="40" y="150" width="400" height="16" fill="var(--accent)" opacity="0.85" />

      <!-- W 标注：位于 D- 上方或 D+ 上方最顶部，避免和 S / S_gnd 在同一水平带 -->
      <line
        x1="259"
        y1="30"
        x2="315"
        y2="30"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <line
        x1="259"
        y1="26"
        x2="259"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <line
        x1="315"
        y1="26"
        x2="315"
        y2="72"
        stroke="var(--border-strong)"
        stroke-dasharray="2 2"
      />
      <text x="287" y="20" text-anchor="middle" class="svg-label-accent">{{ wText }}</text>

      <!-- S 标注：位于 D+ / D- 间隙正上方 y=62 -->
      <line
        x1="221"
        y1="62"
        x2="259"
        y2="62"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="240" y="53" text-anchor="middle" class="svg-label-accent svg-halo">{{ sText }}</text>

      <!-- S_gnd 标注：靠左包地铜皮上方独立区域（x=45..135），绝不碰触中间的 S 与 W -->
      <line
        x1="125"
        y1="62"
        x2="165"
        y2="62"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="42" y="53" text-anchor="start" class="svg-label svg-halo">{{ sGndText }}</text>

      <!-- H / Dk -->
      <line
        x1="78"
        y1="94"
        x2="78"
        y2="148"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="88" y="125" class="svg-label svg-halo">{{ hText }}</text>
      <text x="415" y="125" text-anchor="end" class="svg-label svg-halo">{{ erText }}</text>
      <text x="240" y="162" text-anchor="middle" class="svg-gnd">{{ refLabel }}</text>
    </template>

    <!-- 4. 内层单端 / 差分带状线 -->
    <template v-else-if="kind === 'stripline' || kind === 'diff-stripline'">
      <rect x="40" y="18" width="400" height="14" fill="var(--accent)" opacity="0.85" />
      <text x="240" y="28" text-anchor="middle" class="svg-gnd">上参考 · {{ refAboveLabel }}</text>

      <rect x="40" y="32" width="400" height="124" fill="url(#pcb-dielectric-hatch)" />
      <rect
        x="40"
        y="32"
        width="400"
        height="124"
        fill="none"
        stroke="var(--border-strong)"
        stroke-width="1"
      />

      <rect x="40" y="156" width="400" height="14" fill="var(--accent)" opacity="0.85" />
      <text x="240" y="166" text-anchor="middle" class="svg-gnd">下参考 · {{ refBelowLabel }}</text>

      <template v-if="kind === 'stripline'">
        <rect x="210" y="82" width="80" height="14" fill="var(--warn)" rx="1" />
        <line
          x1="210"
          y1="62"
          x2="290"
          y2="62"
          stroke="var(--text-dim)"
          stroke-width="1.2"
          marker-start="url(#pcb-arrow)"
          marker-end="url(#pcb-arrow)"
        />
        <text x="250" y="53" text-anchor="middle" class="svg-label-accent svg-halo">
          {{ wText }}
        </text>
      </template>
      <template v-else>
        <rect x="175" y="82" width="60" height="14" fill="var(--warn)" rx="1" />
        <rect x="275" y="82" width="60" height="14" fill="var(--warn)" rx="1" />
        <line
          x1="175"
          y1="62"
          x2="235"
          y2="62"
          stroke="var(--text-dim)"
          stroke-width="1.2"
          marker-start="url(#pcb-arrow)"
          marker-end="url(#pcb-arrow)"
        />
        <text x="205" y="53" text-anchor="middle" class="svg-label-accent svg-halo">
          {{ wText }}
        </text>
        <line
          x1="235"
          y1="108"
          x2="275"
          y2="108"
          stroke="var(--text-dim)"
          stroke-width="1.2"
          marker-start="url(#pcb-arrow)"
          marker-end="url(#pcb-arrow)"
        />
        <text x="255" y="122" text-anchor="middle" class="svg-label-accent svg-halo">
          {{ sText }}
        </text>
      </template>

      <!-- H1 / H2 位于最左侧独立区域，远离 x=175 的走线 -->
      <line
        x1="62"
        y1="34"
        x2="62"
        y2="80"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="70" y="60" class="svg-label svg-halo">{{ h1Text }}</text>

      <line
        x1="62"
        y1="98"
        x2="62"
        y2="154"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="70" y="132" class="svg-label svg-halo">{{ h2Text }}</text>
      <text x="424" y="132" text-anchor="end" class="svg-label svg-halo">
        {{ erText }} · {{ tText }}
      </text>
    </template>

    <!-- 5. 过孔截面视图 -->
    <template v-else>
      <rect x="60" y="44" width="360" height="100" fill="url(#pcb-dielectric-hatch)" />
      <rect
        x="60"
        y="44"
        width="360"
        height="100"
        fill="none"
        stroke="var(--border-strong)"
        stroke-width="1"
      />
      <!-- 内层平面与反焊盘隔离区 -->
      <rect x="60" y="90" width="95" height="8" fill="var(--accent)" opacity="0.7" />
      <rect x="325" y="90" width="95" height="8" fill="var(--accent)" opacity="0.7" />
      <!-- 顶部与底部焊盘 -->
      <rect x="165" y="36" width="150" height="8" fill="var(--warn)" rx="1" />
      <rect x="165" y="144" width="150" height="8" fill="var(--warn)" rx="1" />
      <!-- 孔壁镀铜 -->
      <rect x="192" y="44" width="8" height="100" fill="var(--warn)" />
      <rect x="280" y="44" width="8" height="100" fill="var(--warn)" />
      <!-- 钻孔通孔内腔（加宽至 80px，保证孔径文字在内部从容显示） -->
      <rect x="200" y="36" width="80" height="116" fill="var(--bg-sunken)" />

      <!-- 孔径标注 -->
      <line
        x1="200"
        y1="96"
        x2="280"
        y2="96"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="240" y="84" text-anchor="middle" class="svg-label-accent svg-halo">
        孔 {{ holeDiaMm.toFixed(2) }}mm
      </text>

      <!-- 焊盘外径标注 -->
      <line
        x1="165"
        y1="24"
        x2="315"
        y2="24"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="240" y="15" text-anchor="middle" class="svg-label">
        焊盘 {{ padDiaMm.toFixed(2) }} mm
      </text>

      <!-- 反焊盘标注 -->
      <line
        x1="155"
        y1="164"
        x2="325"
        y2="164"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="240" y="179" text-anchor="middle" class="svg-label-dim">
        反焊盘 {{ antiPadDiaMm.toFixed(2) }} mm
      </text>

      <!-- 板厚与镀铜标注在左右干净区域 -->
      <line
        x1="44"
        y1="44"
        x2="44"
        y2="144"
        stroke="var(--text-dim)"
        stroke-width="1.2"
        marker-start="url(#pcb-arrow)"
        marker-end="url(#pcb-arrow)"
      />
      <text x="72" y="64" class="svg-label svg-halo">板厚 {{ boardThicknessMm.toFixed(1) }}mm</text>
      <text x="410" y="64" text-anchor="end" class="svg-label-dim svg-halo">
        镀铜 {{ platingUm }}μm
      </text>
    </template>
  </svg>
</template>

<style scoped>
.pcb-svg {
  display: block;
  width: 100%;
  max-width: 520px;
  height: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.svg-label {
  fill: var(--text);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 500;
}

.svg-label-accent {
  fill: var(--accent-strong);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.svg-label-dim {
  fill: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
}

.svg-halo {
  paint-order: stroke;
  stroke: var(--bg-sunken);
  stroke-width: 4px;
  stroke-linejoin: round;
}

.svg-gnd {
  fill: #ffffff;
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
}

.svg-inner-dark {
  fill: #11141a;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}
</style>
