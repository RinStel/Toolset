/**
 * 自定义控件模板（plan §6.10「模板」）。
 *
 * 每个模板都是一段带注释的 JS 函数体字符串，与 `compileCustomWidget` 的格式一致；
 * 测试会逐个编译验证。
 */

/** 模板条目（与协议模板结构相近，便于编辑器复用）。 */
export interface CustomWidgetTemplate {
  id: string
  name: string
  description: string
  /** 一个 JS 函数体字符串，必须 `return` 一个 CustomWidgetDefinition。 */
  code: string
}

/** 1. 最小数值显示。 */
const MINIMAL_VALUE_CODE = `// 最小数值显示：显示 1 个变量，并用属性设置字号和颜色。
// 在属性面板「数据」页选择变量；没有数据时显示「等待数据…」。
return {
  apiVersion: 1,
  meta: { name: '最小数值显示', description: '显示单个变量的最新值', group: 'value' },
  size: { default: { w: 4, h: 3 }, min: { w: 2, h: 2 } },
  props: [
    { key: 'fontSize', label: '字号', tab: 'style', type: 'number', min: 10, max: 96, step: 1, default: 28 },
    { key: 'decimals', label: '小数位', tab: 'style', type: 'number', min: 0, max: 6, step: 1, default: 2 },
    { key: 'color', label: '颜色', tab: 'style', type: 'color', default: 'auto' },
    { key: 'showUnit', label: '显示单位', tab: 'style', type: 'checkbox', default: true },
  ],
  variables: { min: 1, max: 1 },
  mount(el, ctx) {
    const row = document.createElement('div')
    row.style.cssText =
      'display:flex;align-items:baseline;justify-content:center;gap:4px;height:100%;width:100%;' +
      'font-variant-numeric:tabular-nums;overflow:hidden;'
    const numberEl = document.createElement('span')
    const unitEl = document.createElement('span')
    unitEl.style.opacity = '0.7'
    row.appendChild(numberEl)
    row.appendChild(unitEl)
    el.appendChild(row)

    function render() {
      const props = ctx.props
      const fontSize = Number(props.fontSize === undefined ? 28 : props.fontSize)
      const color = props.color === 'auto' ? ctx.theme('--accent') : String(props.color || '')
      numberEl.style.fontSize = fontSize + 'px'
      numberEl.style.color = color
      unitEl.style.fontSize = Math.max(10, fontSize * 0.45) + 'px'
      const variable = ctx.variables[0]
      unitEl.textContent =
        props.showUnit === false || !variable || !variable.unit ? '' : String(variable.unit)
      const value = ctx.latest(0)
      const decimals = Math.max(0, Math.min(10, Number(props.decimals === undefined ? 2 : props.decimals)))
      numberEl.textContent = value === undefined ? '等待数据…' : value.toFixed(decimals)
    }

    render()
    return {
      update() { render() },
      propsChanged() { render() },
      resize() { render() },
      destroy() { el.replaceChildren() },
    }
  },
}`

/** 2. Canvas 曲线。 */
const CANVAS_CURVE_CODE = `// Canvas 曲线：读取 ctx.history 绘制滚动曲线，update 时重绘。
// 需要绑定 1 个变量；颜色为 auto 时使用变量的系列色。
return {
  apiVersion: 1,
  meta: { name: 'Canvas 曲线', description: '用 Canvas 绘制滚动曲线', group: 'chart' },
  size: { default: { w: 8, h: 6 }, min: { w: 3, h: 3 } },
  props: [
    { key: 'points', label: '绘制点数', tab: 'data', type: 'number', min: 10, max: 5000, step: 10, default: 400 },
    { key: 'lineWidth', label: '线宽', tab: 'style', type: 'number', min: 0.5, max: 6, step: 0.5, default: 1.5 },
    { key: 'color', label: '颜色', tab: 'style', type: 'color', default: 'auto' },
    { key: 'fill', label: '填充', tab: 'style', type: 'checkbox', default: false },
  ],
  variables: { min: 1, max: 1 },
  mount(el, ctx) {
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:100%;height:100%;display:block;'
    el.appendChild(canvas)
    const context = canvas.getContext('2d')

    function draw() {
      if (!context) return
      const dpr = window.devicePixelRatio || 1
      const width = ctx.size.width
      const height = ctx.size.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      const points = Math.max(10, Math.floor(Number(ctx.props.points === undefined ? 400 : ctx.props.points)))
      const slice = ctx.history(0, { last: points })
      const count = slice.v.length
      if (count === 0) return

      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < count; i += 1) {
        const value = slice.v[i]
        if (value < min) min = value
        if (value > max) max = value
      }
      if (!isFinite(min) || !isFinite(max)) return
      if (min === max) {
        min -= 1
        max += 1
      }

      const padding = 6
      const plotWidth = Math.max(1, width - padding * 2)
      const plotHeight = Math.max(1, height - padding * 2)
      const color =
        ctx.props.color === 'auto' ? ctx.theme('--series-1') : String(ctx.props.color || '#4c8dff')

      context.beginPath()
      for (let i = 0; i < count; i += 1) {
        const x = padding + (plotWidth * i) / Math.max(1, count - 1)
        const y = padding + plotHeight * (1 - (slice.v[i] - min) / (max - min))
        if (i === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.strokeStyle = color
      context.lineWidth = Number(ctx.props.lineWidth === undefined ? 1.5 : ctx.props.lineWidth)
      context.stroke()

      if (ctx.props.fill === true) {
        context.lineTo(padding + plotWidth, padding + plotHeight)
        context.lineTo(padding, padding + plotHeight)
        context.closePath()
        context.globalAlpha = 0.15
        context.fillStyle = color
        context.fill()
        context.globalAlpha = 1
      }
    }

    draw()
    return {
      update() { draw() },
      propsChanged() { draw() },
      resize() { draw() },
      destroy() { el.replaceChildren() },
    }
  },
}`

/** 3. 命令按钮组。 */
const COMMAND_BUTTONS_CODE = `// 命令按钮组：按属性中的 options 生成一组按钮，点击后用 ctx.send 发送命令。
// 未设置 command 属性时，把按钮的 value 作为文本模板发往默认数据源。
return {
  apiVersion: 1,
  meta: { name: '命令按钮组', description: '一组按钮，点击发送对应命令', group: 'control' },
  size: { default: { w: 6, h: 3 }, min: { w: 3, h: 2 } },
  props: [
    {
      key: 'options',
      label: '按钮',
      tab: 'data',
      type: 'options',
      default: [
        { label: '启动', value: 1 },
        { label: '停止', value: 0 },
      ],
    },
    { key: 'command', label: '命令', tab: 'behavior', type: 'command', default: null },
    { key: 'columns', label: '列数', tab: 'style', type: 'number', min: 1, max: 6, step: 1, default: 2 },
    { key: 'color', label: '颜色', tab: 'style', type: 'color', default: 'auto' },
  ],
  mount(el, ctx) {
    const container = document.createElement('div')
    container.style.cssText = 'display:grid;gap:6px;width:100%;height:100%;align-content:center;'
    el.appendChild(container)

    function send(value) {
      const command = ctx.props.command
      const sending = command ? ctx.send(command, value) : ctx.send(String(value))
      sending.catch(function (error) {
        ctx.log('发送失败：' + (error && error.message ? error.message : String(error)))
      })
    }

    function render() {
      container.replaceChildren()
      const columns = Math.max(1, Math.min(6, Number(ctx.props.columns === undefined ? 2 : ctx.props.columns)))
      container.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0, 1fr))'
      const color = ctx.props.color === 'auto' ? ctx.theme('--accent') : String(ctx.props.color || '')
      const options = Array.isArray(ctx.props.options) ? ctx.props.options : []
      options.forEach(function (option) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = String(option.label)
        button.style.cssText =
          'border:1px solid ' +
          (color || 'currentColor') +
          ';background:transparent;color:inherit;border-radius:6px;padding:4px 8px;' +
          'cursor:pointer;min-height:24px;'
        button.addEventListener('click', function () {
          send(option.value)
        })
        container.appendChild(button)
      })
    }

    render()
    return {
      propsChanged() { render() },
      resize() { render() },
      destroy() { el.replaceChildren() },
    }
  },
}`

/** 4. 姿态指示器。 */
const ATTITUDE_CODE = `// 姿态指示器：绑定 roll 和 pitch 两个变量，用 Canvas 绘制人工地平线。
// 第 1 个变量为 roll（度），第 2 个变量为 pitch（度）。
return {
  apiVersion: 1,
  meta: { name: '姿态指示器', description: '用 roll/pitch 绘制人工地平线', group: 'value' },
  size: { default: { w: 6, h: 6 }, min: { w: 3, h: 3 } },
  props: [
    { key: 'skyColor', label: '天空色', tab: 'style', type: 'color', default: '#2b6cb0' },
    { key: 'groundColor', label: '地面色', tab: 'style', type: 'color', default: '#8b5a2b' },
    {
      key: 'pixelsPerDegree',
      label: '每度像素',
      tab: 'style',
      type: 'number',
      min: 1,
      max: 30,
      step: 0.5,
      default: 8,
    },
  ],
  variables: { min: 2, max: 2 },
  mount(el, ctx) {
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width:100%;height:100%;display:block;'
    el.appendChild(canvas)
    const context = canvas.getContext('2d')

    function draw() {
      if (!context) return
      const dpr = window.devicePixelRatio || 1
      const width = ctx.size.width
      const height = ctx.size.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)

      const roll = ctx.latest(0)
      const pitch = ctx.latest(1)
      const scale = Number(
        ctx.props.pixelsPerDegree === undefined ? 8 : ctx.props.pixelsPerDegree,
      )
      const cx = width / 2
      const cy = height / 2

      context.save()
      context.beginPath()
      context.arc(cx, cy, Math.max(1, Math.min(cx, cy) - 2), 0, Math.PI * 2)
      context.clip()
      context.translate(cx, cy)
      context.rotate(((roll === undefined ? 0 : roll) * Math.PI) / 180)
      const pitchOffset = (pitch === undefined ? 0 : pitch) * scale
      context.fillStyle = String(ctx.props.skyColor || '#2b6cb0')
      context.fillRect(-width, -height, width * 2, height + pitchOffset)
      context.fillStyle = String(ctx.props.groundColor || '#8b5a2b')
      context.fillRect(-width, pitchOffset, width * 2, height)
      context.strokeStyle = 'rgba(255,255,255,0.85)'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(-width, pitchOffset)
      context.lineTo(width, pitchOffset)
      context.stroke()
      context.restore()

      context.strokeStyle = 'rgba(255,255,255,0.9)'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(cx - 18, cy)
      context.lineTo(cx - 6, cy)
      context.moveTo(cx + 6, cy)
      context.lineTo(cx + 18, cy)
      context.stroke()
    }

    draw()
    return {
      update() { draw() },
      propsChanged() { draw() },
      resize() { draw() },
      destroy() { el.replaceChildren() },
    }
  },
}`

/** 4 个内置模板（plan §6.10）。 */
export const CUSTOM_WIDGET_TEMPLATES: readonly CustomWidgetTemplate[] = [
  {
    id: 'minimal-value',
    name: '最小数值显示',
    description: '显示 1 个变量，字号、小数位和颜色可调。',
    code: MINIMAL_VALUE_CODE,
  },
  {
    id: 'canvas-curve',
    name: 'Canvas 曲线',
    description: '使用 history 与 Canvas 绘制滚动曲线。',
    code: CANVAS_CURVE_CODE,
  },
  {
    id: 'command-buttons',
    name: '命令按钮组',
    description: '按 options 生成按钮组，点击发送命令。',
    code: COMMAND_BUTTONS_CODE,
  },
  {
    id: 'attitude-indicator',
    name: '姿态指示器',
    description: '绑定 roll 与 pitch，用 Canvas 绘制人工地平线。',
    code: ATTITUDE_CODE,
  },
]
