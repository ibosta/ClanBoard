// SPA build: pass-through; the callers already fetch the Express backend.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useServerFn<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}
