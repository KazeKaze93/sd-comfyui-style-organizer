import { useEffect, useState } from 'react'

export interface EditStyleDialogProps {
  open: boolean
  style: {
    name: string
    description: string
    category: string
    prompt: string
    negative_prompt: string
  }
  categories: string[]
  nameEditable?: boolean
  onSave: (fields: {
    name: string
    description: string
    category: string
    prompt: string
    negative_prompt: string
  }) => void
  onCancel: () => void
}

const inputClassName =
  'w-full h-9 px-3 rounded border border-sg-border bg-sg-surface text-sg-text text-sm placeholder:text-sg-muted focus:border-sg-accent focus:outline-none transition-colors'

const textareaClassName =
  'w-full min-h-20 px-3 py-2 rounded border border-sg-border bg-sg-surface text-sg-text text-sm placeholder:text-sg-muted focus:border-sg-accent focus:outline-none transition-colors resize-y'

const labelClassName = 'text-xs text-sg-muted mb-1'

const chipClassName =
  'px-2 py-0.5 text-xs rounded-full border border-sg-border text-sg-muted hover:bg-sg-accent/20 hover:text-sg-text transition-colors'

export function EditStyleDialog({
  open,
  style,
  categories,
  nameEditable = false,
  onSave,
  onCancel,
}: EditStyleDialogProps) {
  const [name, setName] = useState(style.name)
  const [description, setDescription] = useState(style.description)
  const [category, setCategory] = useState(style.category)
  const [prompt, setPrompt] = useState(style.prompt)
  const [negativePrompt, setNegativePrompt] = useState(style.negative_prompt)

  useEffect(() => {
    if (!open) return
    setName(style.name)
    setDescription(style.description)
    setCategory(style.category)
    setPrompt(style.prompt)
    setNegativePrompt(style.negative_prompt)
  }, [open, style.name])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="mb-3">
            <div className={labelClassName}>Category</div>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClassName}
            />
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
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
              onChange={(e) => setPrompt(e.target.value)}
              className={textareaClassName}
            />
          </div>

          <div className="mb-3">
            <div className={labelClassName}>Negative prompt</div>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className={textareaClassName}
            />
          </div>

          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-sg-text border border-sg-border rounded hover:bg-sg-accent/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={nameEditable && name.trim() === ''}
              onClick={() =>
                onSave({
                  name: nameEditable ? name.trim() : style.name,
                  description,
                  category,
                  prompt,
                  negative_prompt: negativePrompt,
                })
              }
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
