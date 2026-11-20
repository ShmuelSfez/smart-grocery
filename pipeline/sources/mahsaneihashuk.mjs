// Official Machsanei HaShuk (מחסני השוק) Price Transparency adapter via LaibCatalog (GLN 7290661400001).
import { createLaibCatalogSource } from './laibcatalog.mjs';

const source = createLaibCatalogSource({
  chainId: 'mahsaneihashuk',
  chainGln: '7290661400001',
});

export const listFeeds = source.listFeeds;
