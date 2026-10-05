import { Loader, Stack, Text } from '@mantine/core'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState } from 'react'

GlobalWorkerOptions.workerSrc = workerUrl
const MAX_PAGES = 60

/** Podgląd PDF (pdf.js) z danych pobranych porcjami przez API — bez linków Drive i bez tokenu w URL. */
export function PdfViewer({ data }: { data: ArrayBuffer }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    const task = getDocument({ data: new Uint8Array(data.slice(0)) })
    const container = ref.current!
    container.innerHTML = ''
    void (async () => {
      const doc = await task.promise
      if (cancelled) return
      setPages(doc.numPages)
      const width = container.clientWidth || 700
      for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES) && !cancelled; i++) {
        const page = await doc.getPage(i)
        const vp1 = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: (width / vp1.width) * (window.devicePixelRatio || 1) })
        const canvas = document.createElement('canvas')
        canvas.width = vp.width
        canvas.height = vp.height
        canvas.style.width = '100%'
        canvas.style.marginBottom = '8px'
        canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.15)'
        container.appendChild(canvas)
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
      }
    })()
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data])
  return (
    <Stack gap={4}>
      {pages === null && <Loader size="sm" />}
      <div ref={ref} />
      {pages !== null && pages > MAX_PAGES && <Text size="xs" c="dimmed">Pokazano {MAX_PAGES} z {pages} stron</Text>}
    </Stack>
  )
}
