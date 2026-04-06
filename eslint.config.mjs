import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'docs/**', 'node_modules/**', 'coverage/**'],
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.vitest.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['*.config.ts', '*.config.mjs', 'eslint.config.mjs'],
    languageOptions: {
      parserOptions: {
        project: false, // Don't require tsconfig for config files
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    }
  }
);
