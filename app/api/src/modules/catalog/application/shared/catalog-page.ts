export interface CatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
