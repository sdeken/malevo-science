import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The extension's tests run against a stand-in for VS Code's API.
  resolve: { alias: { vscode: path.resolve(__dirname, 'vscode/test/fake-vscode.ts') } },
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts', 'vscode/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000
  }
})
