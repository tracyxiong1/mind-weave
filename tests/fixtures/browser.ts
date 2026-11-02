import { expect, test as base } from '@playwright/test'

/** Check every page, including reloads and reopened real canvases. */
export const test = base.extend<{ browserErrors: void }>({
  browserErrors: [async ({ page, context }, use) => {
    const errors: string[] = []
    const observe = (target: typeof page) => target.on('pageerror', error => errors.push(error.stack ?? error.message))
    observe(page)
    context.on('page', observe)
    await use()
    context.off('page', observe)
    expect(errors, 'The canvas must remain usable without browser errors.').toEqual([])
  }, { auto: true }],
})
export { expect }
