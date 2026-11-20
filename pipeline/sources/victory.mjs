// Official Victory (ויקטורי) Price Transparency adapter via LaibCatalog (GLN 7290696200003).
import { createLaibCatalogSource } from './laibcatalog.mjs';

const source = createLaibCatalogSource({
  chainId: 'victory',
  chainGln: '7290696200003',
});

export const listFeeds = source.listFeeds;
