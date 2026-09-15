import { ok, unwrapOr } from '@/core/result'

export function App() {
  return <main className="p-4 font-mono text-fg">{unwrapOr(ok('脚手架就绪'), '')}</main>
}
