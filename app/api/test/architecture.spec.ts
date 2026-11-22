import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : productionFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

function sourcePath(file: string): string {
  return relative(sourceRoot, file).split(sep).join('/');
}

function importSpecifier(node: ts.Node): string | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) &&
        node.expression.text === 'require')) &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    return node.arguments[0].text;
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteralLike(node.argument.literal)
  ) {
    return node.argument.literal.text;
  }
  return undefined;
}

function readsEnvironment(node: ts.Node): boolean {
  return (
    (ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      node.name.text === 'env') ||
    (ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'process' &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'env')
  );
}

describe('Clean Architecture dependency boundaries', () => {
  it('core code crosses module boundaries only through published contracts', () => {
    const violations: string[] = [];
    for (const file of productionFiles(sourceRoot)) {
      const owner = /^modules\/([^/]+)\/(domain|application)\//.exec(
        sourcePath(file),
      );
      if (!owner) continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        const specifier = importSpecifier(node);
        if (specifier?.startsWith('.')) {
          const target = sourcePath(resolve(dirname(file), specifier));
          const dependency = /^modules\/([^/]+)\/(.+)$/.exec(target);
          if (
            dependency &&
            dependency[1] !== owner[1] &&
            !dependency[2].startsWith('contracts/')
          )
            violations.push(
              `${sourcePath(file)} imports private module code ${specifier}`,
            );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
  it.each(['domain', 'application'] as const)(
    '%s stays independent of outer layers and environment configuration',
    (layer) => {
      const forbiddenLayers =
        layer === 'domain'
          ? ['application', 'presentation', 'infrastructure']
          : ['presentation', 'infrastructure'];
      const violations: string[] = [];
      const files = productionFiles(sourceRoot).filter((file) =>
        sourcePath(file).match(new RegExp(`^modules/[^/]+/${layer}/`)),
      );
      expect(
        files.length,
        `No production ${layer} files were inspected`,
      ).toBeGreaterThan(0);

      for (const file of files) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        function visit(node: ts.Node): void {
          const specifier = importSpecifier(node);
          if (specifier) {
            const target = specifier.startsWith('.')
              ? sourcePath(resolve(dirname(file), specifier))
              : specifier;
            if (
              /^@(?:nestjs|prisma)\//.test(target) ||
              /^(?:config|platform)\//.test(target) ||
              forbiddenLayers.some((outer) => target.split('/').includes(outer))
            ) {
              violations.push(`${sourcePath(file)} imports ${specifier}`);
            }
          }
          if (readsEnvironment(node)) {
            violations.push(`${sourcePath(file)} reads process.env`);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }

      expect(violations).toEqual([]);
    },
  );
});
