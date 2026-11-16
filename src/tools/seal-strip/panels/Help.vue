<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
const features = [
  {
    title: '主封箱编号（SEAL ID）',
    text: '11 位字符并剔除易混淆字符 0 / O / 1 / I，支持全随机或 Python 兼容种子确定性复现。',
  },
  {
    title: '三重密码学派生防伪',
    text: '由 SEAL ID 派生 10 位 SHA-256 校验码（CHK）、16 位微缩摘要及 6 位 BLAKE2s 独立签名短码（SIG）。',
  },
  {
    title: '4×4 抗视频压缩视觉指纹',
    text: '结合 SHA-256 位图与稀疏度钳制（4–12 格），即使在低码率开箱视频中依然清晰可辨。',
  },
  {
    title: '专属波浪底纹与骑缝刻度',
    text: '5 条种子正弦叠加曲线防扫描翻印，四边中点骑缝对齐线与右下斜切引导线便于跨胶带贴封与留证。',
  },
]

const printTips = [
  '纸张与比例：A4 纵向（210×297mm），打印设置务必选择「100% 实际大小 / 无缩放」，单卡尺寸严格为 56×34mm。',
  '油墨设置：黑白激光打印机建议使用默认「纯黑激光实色（#000000）」并关闭省墨模式，避免半调网点导致微缩文字糊字。',
  '专用字体：推荐安装或在「专用字体」标签页加载 Space Grotesk、LXGW WenKai、IBM Plex Mono，确保字形与字宽严格一致。',
]
</script>

<template>
  <div class="seal-help">
    <section class="seal-help__section">
      <h3 class="seal-help__heading">防伪要素</h3>
      <ul class="seal-help__list">
        <li v-for="item in features" :key="item.title">
          <strong class="seal-help__strong">{{ item.title }}：</strong>
          <span class="seal-help__text">{{ item.text }}</span>
        </li>
      </ul>
    </section>

    <section class="seal-help__section">
      <h3 class="seal-help__heading">激光打印与裁剪</h3>
      <ul class="seal-help__list">
        <li v-for="tip in printTips" :key="tip" class="seal-help__text">• {{ tip }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.seal-help {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.seal-help__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.seal-help__section + .seal-help__section {
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}

.seal-help__heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.seal-help__heading::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.seal-help__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.seal-help__strong {
  color: var(--text);
  font-weight: 600;
  font-size: 11px;
}

.seal-help__text {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
}
</style>
