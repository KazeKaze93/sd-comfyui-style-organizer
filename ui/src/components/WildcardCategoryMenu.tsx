import { sendToHost } from '../bridge'

type WildcardCategoryMenuProps = {
  category: string
  x: number
  y: number
  onClose: () => void
}

/** Shared right-click menu: insert `{sg:category}` wildcard into the host. */
export function WildcardCategoryMenu({
  category,
  x,
  y,
  onClose,
}: WildcardCategoryMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="fixed z-[9999] bg-[#0f172a] border border-sg-border rounded-lg shadow-xl py-1 min-w-52"
        style={{ left: x, top: y }}
      >
        <button
          type="button"
          className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-sg-accent/20 transition-colors"
          onClick={() => {
            sendToHost({ type: 'SG_WILDCARD_CATEGORY', category })
            onClose()
          }}
        >
          🎲 Add category as wildcard
        </button>
      </div>
    </>
  )
}
