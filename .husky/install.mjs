if (process.env.NODE_ENV !== 'production' && !process.env.CI) {
  const husky = (await import('husky')).default

  husky()
}
