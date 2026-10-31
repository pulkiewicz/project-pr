import { describe, expect, it } from 'vitest'
import { embedPreviewUrl } from './hrf.ts'

describe('podgląd linku do pliku', () => {
  const ID = '1AbCdEfGhIjKlMnOpQrStUv_w-xyz'

  it('Google Drive: plik, open?id= i folder', () => {
    expect(embedPreviewUrl(`https://drive.google.com/file/d/${ID}/view?usp=sharing`)).toBe(`https://drive.google.com/file/d/${ID}/preview`)
    expect(embedPreviewUrl(`https://drive.google.com/open?id=${ID}`)).toBe(`https://drive.google.com/file/d/${ID}/preview`)
    expect(embedPreviewUrl(`https://drive.google.com/drive/u/0/folders/${ID}`)).toBe(`https://drive.google.com/embeddedfolderview?id=${ID}#list`)
  })

  it('Google Docs / Sheets / Slides', () => {
    expect(embedPreviewUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/preview`)
    expect(embedPreviewUrl(`https://docs.google.com/document/d/${ID}/edit`)).toBe(`https://docs.google.com/document/d/${ID}/preview`)
  })

  it('inne adresy i http — brak podglądu', () => {
    expect(embedPreviewUrl('https://example.com/plik.pdf')).toBeNull()
    expect(embedPreviewUrl(`http://drive.google.com/file/d/${ID}/view`)).toBeNull()
    expect(embedPreviewUrl('https://drive.google.com/drive/my-drive')).toBeNull()
    expect(embedPreviewUrl('nie-url')).toBeNull()
  })
})
