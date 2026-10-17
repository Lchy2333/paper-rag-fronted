import { ref } from 'vue'

const THEME_KEY = 'prf_theme'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function loadInitialDark(): boolean {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return systemPrefersDark()
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
}

const isDark = ref(loadInitialDark())
applyTheme(isDark.value)

/** 全局暗色模式状态：默认跟随系统偏好，手动切换后写入 localStorage。 */
export function useTheme() {
  function toggleTheme() {
    isDark.value = !isDark.value
    try {
      localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
    applyTheme(isDark.value)
  }

  return { isDark, toggleTheme }
}
