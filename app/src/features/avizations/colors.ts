import type { AvizationStatus } from '#shared'

export const AVIZ_COLOR: Record<AvizationStatus, string> = { draft: 'gray', sent: 'navy', accepted: 'green', rejected: 'red', cancelled: 'dark' }
