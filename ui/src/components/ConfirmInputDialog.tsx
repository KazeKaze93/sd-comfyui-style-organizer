import { useEffect, useRef, useState } from 'react'

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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false)
      return
    }
    setValue(initialValue)
    setIsSubmitting(false)
    // Defer focus until after paint so the input is mounted.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, initialValue])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!isSubmitting) onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onCancel, isSubmitting])

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
          className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-80"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-sm font-medium text-sg-text mb-2">{title}</div>
          <input
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
            className="w-full h-9 px-3 rounded border border-sg-border
                       bg-sg-surface text-sg-text text-sm
                       placeholder:text-sg-muted focus:border-sg-accent
                       focus:outline-none transition-colors disabled:opacity-45"
          />
          {suggestions && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setValue(s)}
                  className="px-2 py-0.5 text-xs rounded-full border border-sg-border text-sg-muted hover:bg-sg-accent/20 hover:text-sg-text transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
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
              className="px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded hover:bg-sg-accent/20 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => void submit()}
              className="px-3 py-1.5 text-sm rounded bg-sg-accent text-white hover:bg-sg-accent/90 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
