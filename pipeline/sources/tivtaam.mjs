// Official Tiv Taam (טיב טעם) Price Transparency adapter via Cerberus (username 'TivTaam', GLN 7290873255550).
import { createCerberusSource } from './cerberus.mjs';

const source = createCerberusSource({
  chainId: 'tivtaam',
  username: 'TivTaam',
  chainGln: '7290873255550',
});

export const listFeeds = source.listFeeds;
