import { err, ok, type Result } from '@/core/result'
import { isTauri } from './file'

async function writeTextViaTauri(text: string): Promise<Result<void>> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
    return ok(undefined)
  } catch (cause) {
    return err('写入剪贴板失败', {
      code: 'CLIPBOARD_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/**
 * 写入文本剪贴板。
 *
 * 先试 Web Clipboard API；它要求安全上下文且可能被权限策略拒绝，
 * 因此在 Tauri 环境中回退到原生剪贴板插件。
 */
export async function copyText(text: string): Promise<Result<void>> {
  if (text.length === 0) return err('没有可复制的内容', { code: 'EMPTY' })

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return ok(undefined)
    } catch {
      // 继续尝试 Tauri 回退
    }
  }

  if (isTauri()) return writeTextViaTauri(text)

  return err('当前环境不支持写入剪贴板', {
    code: 'CLIPBOARD_UNAVAILABLE',
    detail: '请手动选中内容后复制',
  })
}

/** 图片复制能力探测：不可用时界面应隐藏该按钮并改为提供下载。 */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  )
}

export async function copyImage(blob: Blob): Promise<Result<void>> {
  if (!canCopyImage()) {
    return err('当前环境不支持复制图片', {
      code: 'CLIPBOARD_UNAVAILABLE',
      detail: '可改用下载 PNG',
    })
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return ok(undefined)
  } catch (cause) {
    return err('复制图片失败', {
      code: 'CLIPBOARD_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
