import { describe, expect, it } from 'vitest'
import { parseDriveFolderId } from './ai.ts'

describe('parseDriveFolderId', () => {
  it('rozpoznaje linki do folderu i sam identyfikator', () => {
    expect(parseDriveFolderId('https://drive.google.com/drive/folders/1AbC_def-GHIjkl?usp=sharing')).toBe('1AbC_def-GHIjkl')
    expect(parseDriveFolderId('https://drive.google.com/drive/u/1/folders/1AbC_def-GHIjkl')).toBe('1AbC_def-GHIjkl')
    expect(parseDriveFolderId('https://drive.google.com/open?id=1AbC_def-GHIjkl')).toBe('1AbC_def-GHIjkl')
    expect(parseDriveFolderId(' 1AbC_def-GHIjkl ')).toBe('1AbC_def-GHIjkl')
    expect(parseDriveFolderId('https://example.com/x')).toBeNull()
  })
})
