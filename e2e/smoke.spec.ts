import { expect, test } from '@playwright/test'

test('ekran logowania po polsku, bez rejestracji', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Logowanie' })).toBeVisible()
  await expect(page.getByLabel('E-mail')).toBeVisible()
  await expect(page.getByText('Dostęp wyłącznie na zaproszenie administratora.')).toBeVisible()
  await expect(page.getByText(/zarejestruj/i)).toHaveCount(0)
})

test('API bez tokenu zwraca 401 problem+json', async ({ request }) => {
  const res = await request.get('/api/me')
  expect(res.status()).toBe(401)
  expect(res.headers()['content-type']).toContain('application/problem+json')
})

test('nagłówki bezpieczeństwa na stronie', async ({ request }) => {
  const res = await request.get('/')
  const h = res.headers()
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['content-security-policy']).toContain("script-src 'self'")
})
