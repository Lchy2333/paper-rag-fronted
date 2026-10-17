import { marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

// 代码块高亮：未知语言回退到 plaintext，避免抛错
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      try {
        return hljs.highlight(code, { language }).value
      } catch {
        return code
      }
    },
  }),
)

marked.setOptions({
  gfm: true,
  breaks: true, // LLM 输出常以换行分段，开启后单换行渲染为 <br>
})

// 链接统一新窗口打开，并加 noopener 防 XSS / 隐私风险
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** 将 Markdown 渲染为安全的 HTML（代码高亮 + XSS 清洗）。 */
export function renderMarkdown(content: string): string {
  const raw = marked.parse(content, { async: false }) as string
  return DOMPurify.sanitize(raw)
}
