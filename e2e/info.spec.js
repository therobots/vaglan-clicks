import { expect, test } from '@playwright/test'

test('Info page is reachable, bilingual, and linked to the gallery', async ({ page }) => {
  await page.goto('/info')
  await expect(page.getByRole('heading', { name: 'Photo information' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Photos', exact: true })).toHaveAttribute('href', '/')

  await page.getByRole('button', { name: 'el' }).click()
  await expect(page.getByRole('heading', { name: 'Πληροφορίες φωτογραφιών' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'el')

  await page.getByRole('link', { name: 'Φωτογραφίες', exact: true }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('navigation', { name: 'Gallery pages' })).toBeVisible()
})

test('Order-token route renders the success view with an Info link', async ({ page }) => {
  await page.goto('/orders/example-order-token')
  await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Photo information and removal requests' })).toHaveAttribute('href', '/info')
})
