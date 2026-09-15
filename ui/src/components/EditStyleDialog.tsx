import { useEffect, useState } from 'react'

export interface EditStyleDialogProps {
  open: boolean
  style: {
    name: string
    description: string
    category: string
    prompt: string
    negative_prompt: string
    /** Present for Edit; used to reset the form when switching same-name packs. */
    source_file?: string
  }
  categories: string[]
  nameEditable?: boolean
  onSave: (fields: {
    name: string
    description: string
    category: string
    prompt: string
    negative_prompt: string
  }) => void | Promise<void>
  onCancel: () => void
}

const inputClassName =
  'w-full h-9 px-3 rounded border border-sg-border bg-sg-surface text-sg-text text-sm placeholder:text-sg-muted focus:border-sg-accent focus:outline-none transition-colors disabled:opacity-45'

const textareaClassName =
  'w-full min-h-20 px-3 py-2 rounded border border-sg-border bg-sg-surface text-sg-text text-sm placeholder:text-sg-muted focus:border-sg-accent focus:outline-none transition-colors resize-y disabled:opacity-45'

const labelClassName = 'text-xs text-sg-muted mb-1'

const chipClassName =
  'px-2 py-0.5 text-xs rounded-full border border-sg-border text-sg-muted hover:bg-sg-accent/20 hover:text-sg-text transition-colors disabled:opacity-45 disabled:cursor-not-allowed'

function splitDescriptionAndCombos(raw: string): { text: string; combos: string } {
  const m = /^([\s\S]*?)\s*Combos?:\s*([^.]+)\.?\s*$/i.exec(raw || '')
  if (!m) return { text: raw || '', combos: '' }
  return { text: m[1].trim(), combos: m[2].trim() }
}
function joinDescriptionAndCombos(text: string, combos: string): string {
  const t = (text || '').trim()
  const c = (combos || '').trim()
  if (!c) return t
  return t ? `${t}${t.endsWith('.') ? ' ' : '. '}Combos: ${c}.` : `Combos: ${c}.`
}

export function EditStyleDialog({
  open,
  style,
  categories,
  nameEditable = false,
  onSave,
  onCancel,
}: EditStyleDialogProps) {
  const [name, setName] = useState(style.name)
  const [descriptionText, setDescriptionText] = useState('')
  const [combosText, setCombosText] = useState('')
  const [category, setCategory] = useState(style.category)
  const [prompt, setPrompt] = useState(style.prompt)
  const [negativePrompt, setNegativePrompt] = useState(style.negative_prompt)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false)
      return
    }
    setName(style.name)
    { const parsed = splitDescriptionAndCombos(style.description)
      setDescriptionText(parsed.text)
      setCombosText(parsed.combos) }
    setCategory(style.category)
    setPrompt(style.prompt)
    setNegativePrompt(style.negative_prompt)
    setIsSubmitting(false)
    // source_file distinguishes same-name rows from different packs.
    // Do not depend on prompt/description/etc. — a background refetch
    // while the dialog is open would wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: omit field deps so refetch cannot clobber edits
  }, [open, style.name, style.source_file])

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

  const canSave = !(nameEditable && name.trim() === '') && !isSubmitting

  const submit = async () => {
    if (!canSave) return
    setIsSubmitting(true)
    try {
      await Promise.resolve(
        onSave({
          name: nameEditable ? name.trim() : style.name,
          description: joinDescriptionAndCombos(descriptionText, combosText),
          category,
          prompt,
          negative_prompt: negativePrompt,
        }),
      )
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
          className="pointer-events-auto bg-sg-surface border border-sg-border rounded-lg shadow-xl p-4 w-[28rem]"
          onClick={(e) => e.stopPropagation()}
        >
          {nameEditable ? (
            <div className="mb-3">
              <div className={labelClassName}>Name</div>
              <input
                type="text"
                value={name}
                disabled={isSubmitting}
                onChange={(e) => setName(e.target.value)}
                placeholder="Style name"
                className={inputClassName}
                autoFocus
              />
            </div>
          ) : (
            <div className="text-sm font-medium text-sg-text mb-3">
              Editing &quot;{style.name}&quot;
            </div>
          )}

          <div className="mb-3">
            <div className={labelClassName}>Description</div>
            <input
              type="text"
              value={descriptionText}
              disabled={isSubmitting}
              onChange={(e) => setDescriptionText(e.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="mb-3">
            <div className={labelClassName}>Combos (optional)</div>
            <input
              type="text"
              value={combosText}
              disabled={isSubmitting}
              placeholder="STYLE_X; CATEGORY_*"
              onChange={(e) => setCombosText(e.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="mb-3">
            <div className={labelClassName}>Category</div>
            <input
              type="text"
              value={category}
              disabled={isSubmitting}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClassName}
            />
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setCategory(c)}
                    className={chipClassName}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mb-3">
            <div className={labelClassName}>Prompt</div>
            <textarea
              value={prompt}
              disabled={isSubmitting}
              onChange={(e) => setPrompt(e.target.value)}
              className={textareaClassName}
            />
          </div>

          <div className="mb-3">
            <div className={labelClassName}>Negative prompt</div>
            <textarea
              value={negativePrompt}
              disabled={isSubmitting}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className={textareaClassName}
            />
          </div>

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
              disabled={!canSave}
              onClick={() => void submit()}
              className="px-3 py-1.5 text-sm rounded bg-sg-accent text-white hover:bg-sg-accent/90 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
