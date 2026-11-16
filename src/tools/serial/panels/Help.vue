<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
/**
 * 串口上位机精简帮助面板（由应用外壳「帮助」抽屉按需挂载）。
 */

const quickStart = [
  {
    title: '端口与参数',
    text: '左侧选择硬件串口或「演示端口」，波特率等参数需在断开状态下调整。',
  },
  {
    title: '显示模式',
    text: '支持「原始 / 解析 / 原始+解析」切换；解析模式下点击行可展开原始报文。',
  },
  {
    title: '仪表盘',
    text: '顶栏切换到「仪表盘」或同屏视图，可「一键生成」或拖入变量，编辑/运行模式一键切换。',
  },
  {
    title: '安全与文档',
    text: '自定义控件拥有页面权限，异常时可用 #/tools/serial?safe=1 安全模式禁用；详见 docs/。',
  },
]

const shortcuts = [
  { keys: 'Ctrl / ⌘ + Enter', description: '发送手动输入（支持 Enter 发送模式）' },
  { keys: 'Alt + 1…9', description: '将第 N 个会话切入当前焦点窗格' },
  { keys: 'Ctrl / ⌘ + Z / Y', description: '仪表盘编辑撤销 / 重做' },
  { keys: 'Ctrl / ⌘ + C / V / D', description: '复制 / 粘贴 / 创建仪表盘组件副本' },
  { keys: 'Delete / 方向键', description: '删除或移动选中组件（Shift + 方向键调大小）' },
]

const faqs = [
  {
    title: '占用与断开',
    text: '提示端口被占用时请关闭其他串口软件或标签页；设备意外断开会保留日志并待手动重连。',
  },
  {
    title: '协议超时保护',
    text: '协议插件执行超时会自动切回无协议模式，防止页面卡死。',
  },
  {
    title: '转发与控制线',
    text: '转发支持单/双向排队；虚拟端口支持 DTR/RTS 切换，不支持 Break。',
  },
]
</script>

<template>
  <div class="serial-help">
    <section class="serial-help__section">
      <h3 class="serial-help__heading">快速上手</h3>
      <ul class="serial-help__list">
        <li v-for="item in quickStart" :key="item.title">
          <strong class="serial-help__strong">{{ item.title }}：</strong>
          <span class="serial-help__text">{{ item.text }}</span>
        </li>
      </ul>
    </section>

    <section class="serial-help__section">
      <h3 class="serial-help__heading">常用快捷键</h3>
      <ul class="serial-help__shortcuts">
        <li v-for="shortcut in shortcuts" :key="shortcut.keys" class="serial-help__shortcut">
          <kbd class="serial-help__kbd">{{ shortcut.keys }}</kbd>
          <span class="serial-help__text">{{ shortcut.description }}</span>
        </li>
      </ul>
    </section>

    <section class="serial-help__section">
      <h3 class="serial-help__heading">常见问题</h3>
      <ul class="serial-help__list">
        <li v-for="item in faqs" :key="item.title">
          <strong class="serial-help__strong">{{ item.title }}：</strong>
          <span class="serial-help__text">{{ item.text }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.serial-help {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.serial-help__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.serial-help__section + .serial-help__section {
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
}

.serial-help__heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
}

.serial-help__heading::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: var(--border);
}

.serial-help__text {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.6;
}

.serial-help__strong {
  color: var(--text);
  font-weight: 600;
  font-size: 11px;
}

.serial-help__shortcuts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.serial-help__shortcut {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.serial-help__kbd {
  flex: none;
  min-width: 112px;
  padding: 1px var(--space-1);
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg-sunken);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 10px;
  text-align: center;
}

.serial-help__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
