import { useEffect, useId, useState } from 'react'

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
              type="button"
              disabled={isSubmitting}
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded hover:bg-sg-accent/20 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => void submit()}
              className={`px-3 py-1.5 text-sm rounded text-white transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                destructive
                  ? 'bg-sg-danger hover:bg-sg-danger/90'
                  : 'bg-sg-accent hover:bg-sg-accent/90'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
