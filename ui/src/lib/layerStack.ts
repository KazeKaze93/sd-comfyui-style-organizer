import { useEffect, useId, useRef } from 'react'

type LayerEntry = {
  id: string
  close: () => void
}

const stack: LayerEntry[] = []

/** Register an overlay layer. Returns unregister (idempotent for this entry). */
export function registerLayer(id: string, close: () => void): () => void {
  const entry: LayerEntry = { id, close }
  stack.push(entry)
  let active = true
  return () => {
    if (!active) return
    active = false
    const index = stack.lastIndexOf(entry)
    if (index >= 0) stack.splice(index, 1)
  }
}

/** Close the topmost layer (LIFO). Returns true if a layer was closed. */
export function closeTopLayer(): boolean {
  const top = stack.pop()
  if (!top) return false
  top.close()
  return true
}

export function hasOpenLayer(): boolean {
  return stack.length > 0
}

/** Test helper: clear the stack between cases. */
export function resetLayerStackForTests(): void {
  stack.length = 0
}

/**
 * While `open` is true, register this instance on the layer stack.
 * `close` is read from a ref so the registration stays stable across renders.
 */
export function useLayer(open: boolean, close: () => void): void {
  const id = useId()
  const closeRef = useRef(close)

  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    if (!open) return
    return registerLayer(id, () => {
      closeRef.current()
    })
  }, [open, id])
}
