import { computed, ref } from 'vue'

const THEME_KEY = 'prf_theme'

export interface ThemeOption {
  id: string
  /** data-accent 值（CSS 变量按此切换强调色） */
  accent: string
  dark: boolean
  label: string
  /** 色板预览色 */
  color: string
}

/** 主题列表：强调色 × 深浅模式 */
export const THEMES: ThemeOption[] = [
  { id: 'purple-light', accent: 'purple', dark: false, label: '浅紫', color: '#4f6ef7' },
  { id: 'purple-dark', accent: 'purple', dark: true, label: '深紫', color: '#6c86ff' },
  { id: 'blue-light', accent: 'blue', dark: false, label: '浅蓝', color: '#3b82f6' },
  { id: 'blue-dark', accent: 'blue', dark: true, label: '深蓝', color: '#5b9bff' },
  { id: 'green-light', accent: 'green', dark: false, label: '浅绿', color: '#34c759' },
  { id: 'green-dark', accent: 'green', dark: true, label: '深绿', color: '#4ade80' },
  { id: 'orange-light', accent: 'orange', dark: false, label: '浅橙', color: '#f97316' },
  { id: 'orange-dark', accent: 'orange', dark: true, label: '深橙', color: '#fb923c' },
  { id: 'rose-light', accent: 'rose', dark: false, label: '浅玫', color: '#f43f5e' },
  { id: 'rose-dark', accent: 'rose', dark: true, label: '深玫', color: '#fb7185' },
]

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function loadThemeId(): string {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    // 兼容旧版 'light' / 'dark'
    if (saved === 'light') return 'purple-light'
    if (saved === 'dark') return 'purple-dark'
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return systemPrefersDark() ? 'purple-dark' : 'purple-light'
}

function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]
  const root = document.documentElement
  root.classList.toggle('dark', t.dark)
  root.dataset.accent = t.accent
}

const themeId = ref(loadThemeId())
applyTheme(themeId.value)

const isDark = computed(() => THEMES.find((t) => t.id === themeId.value)?.dark ?? false)

/** 全局主题状态：强调色 × 深浅模式，写入 localStorage（'prf_theme'）。 */
export function useTheme() {
  function setTheme(id: string) {
    themeId.value = id
    try {
      localStorage.setItem(THEME_KEY, id)
    } catch {
      /* ignore */
    }
    applyTheme(id)
  }

  return { theme: themeId, isDark, setTheme }
}
