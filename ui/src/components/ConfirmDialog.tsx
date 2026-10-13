import { useEffect, useId, useRef, useState } from 'react'
import { useLayer } from '../lib/layerStack'
import { useFocusTrap } from '../lib/useFocusTrap'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useLayer(open, () => {
    if (!isSubmitting) onCancel()
  })

  useFocusTrap(panelRef, open, {
    initialFocus: destructive ? cancelRef : confirmRef,
  })

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false)
      return
    }
    setIsSubmitting(false)
  }, [open])

  if (!open) return null

  const canConfirm = !isSubmitting

  const submit = async () => {
    if (!canConfirm) return
    setIsSubmitting(true)
    try {
      await Promise.resolve(onConfirm())
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => { if (!isSubmitting) onCancel() }}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-80"
          onClick={(e) => e.stopPropagation()}
        >
          <div id={titleId} className="text-sm font-medium text-sg-text mb-2">
            {title}
          </div>
          <p id={descId} className="text-sm text-sg-muted">
            {message}
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <button
              ref={cancelRef}
              type="button"
              disabled={isSubmitting}
              onClick={onCancel}
              className={cn(
                'px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded hover:bg-sg-accent/20 transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
                FOCUS_RING,
              )}
            >
              Cancel
            </button>
            <button
              ref={confirmRef}
              type="button"
              disabled={!canConfirm}
              onClick={() => void submit()}
              className={cn(
                'px-3 py-1.5 text-sm rounded text-white transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
                destructive
                  ? 'bg-sg-danger hover:bg-sg-danger/90'
                  : 'bg-sg-accent hover:bg-sg-accent/90',
                FOCUS_RING,
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
