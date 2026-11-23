import js from '@eslint/js';
import globals from 'globals';
import pluginSecurity from 'eslint-plugin-security';

export default [
  {
    ignores: ['node_modules/', 'coverage/', 'dist/'],
  },
  js.configs.recommended,
  pluginSecurity.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Mantiene visibles los avisos sin bloquear accesos seguros a diccionarios o mapas por clave.
      'security/detect-object-injection': 'warn',
    },
  },
];
