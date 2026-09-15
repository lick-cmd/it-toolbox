import { Suspense, lazy, useMemo } from 'react'
import type { ToolEntry } from './registry'
import { ToolErrorBoundary } from './ToolErrorBoundary'
import { Spinner } from './ui/Spinner'

export interface ToolHostProps {
  entry: ToolEntry
}

export function ToolHost({ entry }: ToolHostProps) {
  // entry.load 是 glob 产生的懒加载 thunk，lazy() 据此为每个工具生成独立 chunk
  const Tool = useMemo(() => lazy(entry.load), [entry])

  return (
    <ToolErrorBoundary key={entry.meta.id} toolName={entry.meta.name}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner label="加载中…" />
          </div>
        }
      >
        <Tool />
      </Suspense>
    </ToolErrorBoundary>
  )
}
