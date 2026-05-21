import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from 'prosemirror-state'

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const e = el as HTMLElement
          return e.getAttribute('width') || e.style.width || null
        },
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const e = el as HTMLElement
          return e.getAttribute('height') || e.style.height || null
        },
      },
      'data-align': {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-align') || null,
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const { width, height, ...rest } = HTMLAttributes
    const styles: string[] = []
    if (width) styles.push(`width: ${width}`)
    if (height) styles.push(`height: ${height}`)
    // CSS resize handle is applied via class, keep dimensions in style + attrs
    return ['img', {
      ...rest,
      style: styles.length > 0 ? styles.join('; ') : undefined,
      width: width || undefined,
      height: height || undefined,
    }]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('resizableImageSync'),
        props: {
          handleDOMEvents: {
            // Capture CSS-resized dimensions on mouseup (user finishes dragging resize handle)
            mouseup: (view, event) => {
              const target = event.target as HTMLElement
              if (target.tagName !== 'IMG' || !target.closest('.rich-editor-content')) return false
              const { width, height } = target.style
              if (!width && !height) return false
              const pos = view.posAtDOM(target, 0)
              const node = view.state.doc.nodeAt(pos)
              if (!node || node.type.name !== 'image') return false
              view.dispatch(view.state.tr.setNodeMarkup(pos, null, {
                ...node.attrs,
                width: width || node.attrs.width,
                height: height || node.attrs.height,
              }))
              return false
            },
          },
          // Sync dimensions on click (fallback if mouseup missed)
          handleClickOn: (view, pos, node, nodePos, event) => {
            if (node.type.name === 'image') {
              const dom = event.target as HTMLImageElement
              if (dom.style.width || dom.style.height) {
                view.dispatch(view.state.tr.setNodeMarkup(nodePos, null, {
                  ...node.attrs,
                  width: dom.style.width || undefined,
                  height: dom.style.height || undefined,
                }))
              }
            }
            return false
          },
        },
      }),
    ]
  },
})
