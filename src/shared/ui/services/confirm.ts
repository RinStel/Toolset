import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  /** Defaults to 确定. */
  confirmText?: string
  /** Defaults to 取消. */
  cancelText?: string
  /** Renders the confirm button in the danger style. */
  danger?: boolean
}

export interface ConfirmState {
  open: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

/** Reactive state consumed by `ServiceHost.vue`. */
export const confirmState = reactive<ConfirmState>({
  open: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})

const queue: PendingConfirm[] = []
let current: PendingConfirm | null = null

function present(options: ConfirmOptions): void {
  confirmState.title = options.title
  confirmState.message = options.message
  confirmState.confirmText = options.confirmText ?? '确定'
  confirmState.cancelText = options.cancelText ?? '取消'
  confirmState.danger = options.danger ?? false
  confirmState.open = true
}

function showNext(): void {
  current = queue.shift() ?? null
  if (!current) {
    confirmState.open = false
    return
  }
  present(current.options)
}

/**
 * Shows a modal confirmation and resolves with the user's choice. Requests are
 * queued so only one dialog is visible at a time.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue.push({ options, resolve })
    if (!current) showNext()
  })
}

/** Called by `ServiceHost.vue` when the user answered the active confirmation. */
export function settleConfirm(result: boolean): void {
  const pending = current
  if (!pending) return
  current = null
  confirmState.open = false
  pending.resolve(result)
  showNext()
}
