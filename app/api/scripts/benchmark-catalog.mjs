import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const temporaryPrefix = 'marketplate-catalog-benchmark-';
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));

function optionsFrom(arguments_) {
  const options = { products: 2000, requests: 50, concurrency: 5 };
  const maximums = { products: 20000, requests: 500, concurrency: 20 };
  const supplied = new Set();
  for (const argument of arguments_) {
    const match = /^--(products|requests|concurrency)=([1-9]\d*)$/.exec(
      argument,
    );
    if (!match || match[0] !== argument || supplied.has(match[1])) {
      throw new Error(
        'Use each optional flag once: --products=1..20000 --requests=1..500 --concurrency=1..20',
      );
    }
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value) || value > maximums[match[1]]) {
      throw new Error(
        `--${match[1]} must be an integer between 1 and ${maximums[match[1]]}`,
      );
    }
    supplied.add(match[1]);
    options[match[1]] = value;
  }
  return options;
}

function isolatedEnvironment(directory) {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: `file:${join(directory, 'catalog.db').replaceAll('\\', '/')}`,
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(48).toString('hex'),
    IDENTITY_MAIL_TRANSPORT: 'outbox',
    IDENTITY_PUBLIC_APP_URL: '',
    SMTP_HOST: '',
    SMTP_FROM: '',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_REQUIRE_TLS: 'true',
    MEDIA_STORAGE_PATH: join(directory, 'media'),
  });
}

async function migrate() {
  const connection = await new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL,
  }).connect();
  try {
    const directory = join(apiDirectory, 'prisma', 'migrations');
    const migrations = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const migration of migrations) {
      await connection.executeScript(
        await readFile(
          join(directory, migration.name, 'migration.sql'),
          'utf8',
        ),
      );
    }
  } finally {
    await connection.dispose();
  }
}

async function seed(prisma, count, normalizeSearch) {
  const categoryId = randomUUID();
  const baseTimestamp = Date.UTC(2026, 0, 1);
  await prisma.catalogCategory.create({
    data: {
      id: categoryId,
      name: 'Danh mục benchmark',
      slug: 'catalog-benchmark',
    },
  });
  for (let offset = 0; offset < count; offset += 250) {
    const products = [];
    const variants = [];
    for (let index = offset; index < Math.min(offset + 250, count); index++) {
      const suffix = String(index).padStart(6, '0');
      const id = randomUUID();
      const name = `${index % 4 === 0 ? 'Áo thun Việt Nam' : 'Cà phê Việt Nam'} ${suffix}`;
      const slug = `benchmark-product-${suffix}`;
      const description = 'Dữ liệu thử hiệu năng HTTP trong database tạm.';
      const price = 50_000 + (index % 1000) * 1000;
      const timestamp = new Date(baseTimestamp + index * 1000);
      products.push({
        id,
        categoryId,
        shopId: null,
        brandId: null,
        name,
        slug,
        description,
        searchText: normalizeSearch([name, slug, description].join(' ')),
        status: 'PUBLISHED',
        version: 0,
        minPriceAmount: price,
        images: [
          {
            url: 'https://example.invalid/catalog-benchmark.jpg',
            alt: 'Ảnh dữ liệu thử',
          },
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
        publishedAt: timestamp,
      });
      variants.push({
        id: randomUUID(),
        productId: id,
        sku: `BENCH-${suffix}`,
        name: 'Xanh / M',
        priceAmount: price,
        currency: 'VND',
        isActive: true,
        attributes: { color: 'Xanh', size: 'M' },
        images: [],
      });
    }
    await prisma.$transaction([
      prisma.catalogProduct.createMany({ data: products }),
      prisma.catalogVariant.createMany({ data: variants }),
    ]);
  }
  return {
    products: await prisma.catalogProduct.count(),
    variants: await prisma.catalogVariant.count(),
  };
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function percentile(sorted, probability) {
  return sorted.length === 0
    ? null
    : rounded(sorted[Math.max(0, Math.ceil(sorted.length * probability) - 1)]);
}

async function measure(origin, target, options, rowCount) {
  let next = 0;
  let errorCount = 0;
  const latencies = [];
  const errors = new Map();
  const concurrency = Math.min(options.concurrency, options.requests);
  const started = performance.now();
  const worker = async () => {
    while (next < options.requests) {
      next++;
      const requestStarted = performance.now();
      try {
        const response = await fetch(`${origin}${target.path}`, {
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        const body = await response.json();
        if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
        if (
          !Array.isArray(body.items) ||
          body.items.length !==
            Math.min(20, target.search ? Math.ceil(rowCount / 4) : rowCount)
        ) {
          throw new Error('Unexpected response items');
        }
        if (
          target.browse
            ? typeof body.hasNext !== 'boolean'
            : body.total !==
              (target.search ? Math.ceil(rowCount / 4) : rowCount)
        ) {
          throw new Error('Unexpected response pagination');
        }
        if (
          target.search &&
          body.items.some((item) => !item.name.startsWith('Áo thun Việt Nam'))
        ) {
          throw new Error('Vietnamese search returned a nonmatching item');
        }
        latencies.push(performance.now() - requestStarted);
      } catch (error) {
        errorCount++;
        const message =
          error instanceof Error ? error.message : 'Request failed';
        errors.set(message, (errors.get(message) ?? 0) + 1);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = performance.now() - started;
  latencies.sort((left, right) => left - right);
  return {
    route: target.path,
    count: options.requests,
    errorCount,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    throughputRps: rounded((latencies.length * 1000) / elapsedMs),
    elapsedMs: rounded(elapsedMs),
    ...(errorCount > 0
      ? { errors: [...errors].map(([message, count]) => ({ message, count })) }
      : {}),
  };
}

async function cleanUp(app, directory) {
  try {
    if (app) {
      app.getHttpServer().closeIdleConnections?.();
      await app.close();
    }
  } catch (error) {
    process.stderr.write(
      `Could not close benchmark app: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  }
  if (directory) {
    try {
      const target = resolve(directory);
      if (
        dirname(target) !== resolve(tmpdir()) ||
        !basename(target).startsWith(temporaryPrefix)
      ) {
        throw new Error(
          'Refusing to remove a directory outside the benchmark temporary workspace',
        );
      }
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(
        `Could not remove benchmark files: ${error instanceof Error ? error.message : 'unknown error'}\n`,
      );
      process.exitCode = 1;
    }
  }
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  try {
    await access(new URL('../dist/app.module.js', import.meta.url));
  } catch {
    throw new Error('Build the API first: npm run build');
  }
  const started = performance.now();
  let directory;
  let app;
  try {
    directory = await mkdtemp(join(tmpdir(), temporaryPrefix));
    isolatedEnvironment(directory);
    await mkdir(process.env.MEDIA_STORAGE_PATH, { recursive: true });
    await migrate();
    // Environment isolation precedes all application/config module imports.
    const [{ AppModule }, { PrismaService }, { normalizeCatalogSearch }] =
      await Promise.all([
        import(new URL('../dist/app.module.js', import.meta.url).href),
        import(
          new URL(
            '../dist/platform/database/prisma.service.js',
            import.meta.url,
          ).href
        ),
        import(
          new URL(
            '../dist/modules/catalog/domain/policies/catalog-search.policy.js',
            import.meta.url,
          ).href
        ),
      ]);
    app = await NestFactory.create(AppModule, {
      logger: false,
      abortOnError: false,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const rows = await seed(
      app.get(PrismaService),
      options.products,
      normalizeCatalogSearch,
    );
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string')
      throw new Error('Could not resolve benchmark loopback port');
    const origin = `http://127.0.0.1:${address.port}`;
    const setupElapsedMs = performance.now() - started;
    const targets = [
      { path: '/catalog/products?limit=20&page=1' },
      { path: '/catalog/browse?limit=20', browse: true },
      {
        path: `/catalog/products?${new URLSearchParams({ limit: '20', q: 'áo thun' })}`,
        search: true,
      },
    ];
    const measurementsStarted = performance.now();
    const routes = [];
    for (const target of targets)
      routes.push(await measure(origin, target, options, rows.products));
    const report = {
      description:
        'Local loopback HTTP benchmark against an isolated temporary SQLite database; not a production SLA',
      nodeVersion: process.version,
      rowCount: rows.products,
      variantCount: rows.variants,
      concurrency: Math.min(options.concurrency, options.requests),
      requestsPerRoute: options.requests,
      latencyScope:
        'Successful complete HTTP responses including JSON decoding; nearest-rank percentiles; no warmup',
      setupElapsedMs: rounded(setupElapsedMs),
      measurementElapsedMs: rounded(performance.now() - measurementsStarted),
      elapsedMs: rounded(performance.now() - started),
      routes,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (routes.some((route) => route.errorCount > 0)) process.exitCode = 1;
  } finally {
    await cleanUp(app, directory);
  }
}

await main().catch((error) => {
  process.stderr.write(
    `Catalog benchmark failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
