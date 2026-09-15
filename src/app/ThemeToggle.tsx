import { setTheme, usePrefs } from '@/framework/usePrefs'
import { Icon } from '@/framework/ui/Icon'
import { SegmentedControl } from '@/framework/ui/Inputs'
import type { ThemeMode } from '@/framework/theme'

const OPTIONS = [
  { value: 'dark', label: '暗色' },
  { value: 'light', label: '亮色' },
  { value: 'system', label: '跟随系统' },
] as const satisfies readonly { value: ThemeMode; label: string }[]

const ICON_BY_MODE: Record<ThemeMode, 'moon' | 'sun' | 'monitor'> = {
  dark: 'moon',
  light: 'sun',
  system: 'monitor',
}

export function ThemeToggle() {
  const prefs = usePrefs()

  return (
    <div className="flex items-center gap-1.5">
      <Icon name={ICON_BY_MODE[prefs.theme]} size={14} className="text-muted" />
      <SegmentedControl
        label="主题"
        options={OPTIONS}
        value={prefs.theme}
        onChange={setTheme}
      />
    </div>
  )
}
