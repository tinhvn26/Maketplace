import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import ts from 'typescript';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    {
      name: 'nest-decorator-metadata',
      enforce: 'pre',
      transform(source, id) {
        if (!id.endsWith('.ts') || id.includes('/node_modules/')) {
          return null;
        }

        // Nest's dependency injection and ValidationPipe need the same runtime
        // type metadata as the production TypeScript build.
        const result = ts.transpileModule(source, {
          fileName: id,
          compilerOptions: {
            target: ts.ScriptTarget.ES2023,
            module: ts.ModuleKind.ESNext,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            sourceMap: true,
            inlineSources: true,
          },
        });
        return { code: result.outputText, map: result.sourceMapText };
      },
    },
  ],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
