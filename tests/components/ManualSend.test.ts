// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  draft: '',
}))

vi.mock('@/tools/serial/stores/sessions', () => ({
  getSessionInstance: () => ({
    state: 'open',
    compose: {
      mode: 'text',
      encoding: 'utf-8',
      eol: 'none',
      checksum: 'none',
      checksumEndian: 'le',
      checksumSkip: 0,
    },
    send: mocks.send,
  }),
  getSessionView: () => ({
    id: 's1',
    name: '测试会话',
    state: 'open',
    tasks: { repeat: null, macro: null },
  }),
  getSessionDraft: () => mocks.draft,
  setSessionDraft: (_sessionId: string, value: string) => {
    mocks.draft = value
  },
}))

import ManualSend from '@/tools/serial/components/ManualSend.vue'
import { updateSerialSettings } from '@/tools/serial/stores/settings'

function mountSend() {
  return mount(ManualSend, { props: { sessionId: 's1' } })
}

async function selectHex(wrapper: ReturnType<typeof mountSend>): Promise<void> {
  const buttons = wrapper.get('[data-testid="send-mode"]').findAll('button')
  await buttons[1]?.trigger('click')
}

beforeEach(() => {
  mocks.send.mockReset()
  mocks.send.mockResolvedValue(undefined)
  mocks.draft = ''
  updateSerialSettings({ enterToSend: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ManualSend', () => {
  it('HEX 非法时显示错误并禁用发送', async () => {
    const wrapper = mountSend()
    await selectHex(wrapper)
    await wrapper.get('[data-testid="send-input"]').setValue('0G')

    expect(wrapper.text()).toContain('HEX 解析失败')
    expect(wrapper.get('[data-testid="send-button"]').attributes('disabled')).toBeDefined()
  })

  it('显示 HEX 预览并在发送时传入正确的字节', async () => {
    const wrapper = mountSend()
    await selectHex(wrapper)
    await wrapper.get('[data-testid="send-input"]').setValue('01 03')

    expect(wrapper.text()).toContain('将发送 2 字节：01 03')
    const button = wrapper.get('[data-testid="send-button"]')
    expect(button.attributes('disabled')).toBeUndefined()

    await button.trigger('click')
    await flushPromises()

    expect(mocks.send).toHaveBeenCalledTimes(1)
    const [bytes, origin] = mocks.send.mock.calls[0] as [Uint8Array, string]
    expect(Array.from(bytes)).toEqual([0x01, 0x03])
    expect(origin).toBe('manual')
    expect((wrapper.get('[data-testid="send-input"]').element as HTMLTextAreaElement).value).toBe(
      '',
    )
  })

  it('开启 Enter 发送后 Enter 发送、Shift+Enter 不发送、isComposing 不发送', async () => {
    updateSerialSettings({ enterToSend: true })
    const wrapper = mountSend()
    await selectHex(wrapper)
    const input = wrapper.get('[data-testid="send-input"]')
    await input.setValue('01 02')

    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(mocks.send).not.toHaveBeenCalled()

    await input.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(mocks.send).not.toHaveBeenCalled()

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Enter 始终发送，草稿保存在会话 store 中', async () => {
    const wrapper = mountSend()
    await wrapper.get('[data-testid="send-input"]').setValue('草稿内容')
    expect(mocks.draft).toBe('草稿内容')

    await wrapper.get('[data-testid="send-input"]').trigger('keydown', {
      key: 'Enter',
      ctrlKey: true,
    })
    await flushPromises()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})
