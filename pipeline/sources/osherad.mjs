// Official Osher Ad (אושר עד) Price Transparency adapter via Cerberus (username 'osherad', GLN 7290103152017).
import { createCerberusSource } from './cerberus.mjs';

const source = createCerberusSource({
  chainId: 'osherad',
  username: 'osherad',
  chainGln: '7290103152017',
});

export const listFeeds = source.listFeeds;
