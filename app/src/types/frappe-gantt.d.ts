declare module 'frappe-gantt' {
  export interface FrappeTask {
    id: string
    name: string
    start: string
    end: string
    progress?: number
    dependencies?: string
    custom_class?: string
  }
  export interface FrappeOptions {
    view_mode?: string
    language?: string
    readonly?: boolean
    popup_on?: 'click' | 'hover'
    popup?: false | ((ctx: unknown) => void)
    bar_height?: number
    padding?: number
    column_width?: number
    lines?: 'both' | 'vertical' | 'horizontal' | 'none'
    scroll_to?: string | null
    today_button?: boolean
    view_mode_select?: boolean
    infinite_padding?: boolean
    container_height?: number | 'auto'
    on_click?: (task: FrappeTask) => void
    on_view_change?: (mode: unknown) => void
  }
  export default class Gantt {
    constructor(el: HTMLElement | string, tasks: FrappeTask[], options?: FrappeOptions)
    change_view_mode(mode: string, maintainPos?: boolean): void
    refresh(tasks: FrappeTask[]): void
    clear(): void
    gantt_start: Date
    config: { unit: string; step: number; column_width: number; header_height: number }
    options: { bar_height: number; padding: number }
    $svg: SVGSVGElement
    $container: HTMLElement
    grid_height: number
  }
}
declare module 'frappe-gantt.css'
