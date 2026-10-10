import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Pages load data in effects and reset local state when the selection changes; the React
      // Compiler flags that as a performance hint. Kept visible as a warning, not a failure.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Test fakes of the Supabase client are intentionally loose.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  // public/vendor holds third-party code copied unmodified (see its NOTICE.txt).
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/vendor/**']),
])
