/**
 * Application level constants shared by the shell, the router and the layout.
 * Values follow plan.md §7: the header is 44px tall and page titles end with
 * ` · Toolset`.
 */

/** Full product name, used for the document title of the home page. */
export const APP_NAME = 'Toolset · RinStel的工具箱'

/** Short product name shown in the header and used as title suffix. */
export const APP_TITLE = 'Toolset'

/** Subtitle shown next to the short product name in the header. */
export const APP_SUBTITLE = 'RinStel的工具箱'

/** Height of `AppHeader`, must stay in sync with the layout CSS. */
export const APP_HEADER_HEIGHT = 44

/** Suffix used by every tool page title. */
export const TOOL_TITLE_SUFFIX = 'Toolset'

/** Documentation path shown in the help panel (plan §7.2). */
export const TOOL_MODULE_DOC_PATH = 'docs/tool-module.md'

/** Builds the document title of a tool page, e.g. `串口助手 · Toolset`. */
export function toolPageTitle(title: string): string {
  return `${title} · ${TOOL_TITLE_SUFFIX}`
}
