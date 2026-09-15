import { err, ok, type Result } from '@/core/result'

/**
 * 判断是否运行在 Tauri 容器内。
 *
 * 采用运行时探测而非编译期常量：这样同一份代码在浏览器预览与
 * tauri dev 下都能正确分支，UI 开发无需每次启动桌面应用。
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
  yaml: 'application/yaml;charset=utf-8',
  yml: 'application/yaml;charset=utf-8',
  html: 'text/html;charset=utf-8',
  svg: 'image/svg+xml',
  md: 'text/markdown;charset=utf-8',
}

function guessMime(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'text/plain;charset=utf-8'
}

/** 浏览器降级路径：Blob + 临时 <a download>。 */
function downloadViaBrowser(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // 立即回收会中断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function downloadViaTauri(filename: string, blob: Blob | string): Promise<Result<void>> {
  try {
    const [{ save }, { writeFile, writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])

    const path = await save({ defaultPath: filename })
    if (!path) return err('已取消保存', { code: 'CANCELLED' })

    if (typeof blob === 'string') {
      await writeTextFile(path, blob)
    } else {
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    }
    return ok(undefined)
  } catch (cause) {
    return err('保存文件失败', {
      code: 'WRITE_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

export async function downloadBlob(filename: string, blob: Blob): Promise<Result<void>> {
  if (isTauri()) return downloadViaTauri(filename, blob)
  try {
    downloadViaBrowser(filename, blob)
    return ok(undefined)
  } catch (cause) {
    return err('导出文件失败', {
      code: 'DOWNLOAD_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

export async function downloadText(
  filename: string,
  text: string,
  mime?: string,
): Promise<Result<void>> {
  const type = mime ?? guessMime(filename)
  if (isTauri()) return downloadViaTauri(filename, text)
  return downloadBlob(filename, new Blob([text], { type }))
}
