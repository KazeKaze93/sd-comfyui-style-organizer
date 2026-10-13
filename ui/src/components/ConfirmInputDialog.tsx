import { useEffect, useId, useRef, useState } from 'react'
import { useLayer } from '../lib/layerStack'
import { useFocusTrap } from '../lib/useFocusTrap'
import { cn } from '../lib/utils'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sg-accent focus-visible:ring-offset-1 focus-visible:ring-offset-sg-bg'

export interface ConfirmInputDialogProps {
  open: boolean
  title: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  suggestions?: string[]
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}

export function ConfirmInputDialog({
  open,
  title,
  initialValue = '',
  placeholder,
  confirmLabel = 'Confirm',
  suggestions,
  onConfirm,
  onCancel,
}: ConfirmInputDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const inputId = useId()

  useLayer(open, () => {
    if (!isSubmitting) onCancel()
  })

  useFocusTrap(panelRef, open, { initialFocus: inputRef })

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false)
      return
    }
    setValue(initialValue)
    setIsSubmitting(false)
  }, [open, initialValue])

  if (!open) return null

  const trimmed = value.trim()
  const canConfirm = trimmed.length > 0 && !isSubmitting

  const submit = async () => {
    if (!canConfirm) return
    setIsSubmitting(true)
    try {
      await Promise.resolve(onConfirm(trimmed))
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
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-80"
          onClick={(e) => e.stopPropagation()}
        >
          <label id={titleId} htmlFor={inputId} className="block text-sm font-medium text-sg-text mb-2">
            {title}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={value}
            placeholder={placeholder}
            disabled={isSubmitting}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canConfirm) {
                e.preventDefault()
                void submit()
              }
            }}
            className={cn(
              'w-full h-9 px-3 rounded border border-sg-border bg-sg-surface text-sg-text text-sm placeholder:text-sg-muted focus:border-sg-accent focus:outline-none transition-colors disabled:opacity-45',
              FOCUS_RING,
            )}
          />
          {suggestions && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setValue(s)}
                  className={cn(
                    'px-2 py-0.5 text-xs rounded-full border border-sg-border text-sg-muted hover:bg-sg-accent/20 hover:text-sg-text transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
                    FOCUS_RING,
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <button
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
              type="button"
              disabled={!canConfirm}
              onClick={() => void submit()}
              className={cn(
                'px-3 py-1.5 text-sm rounded bg-sg-accent text-white hover:bg-sg-accent/90 transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
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
