// Official Keshet Teamim (קשת טעמים) Price Transparency adapter via Cerberus (username 'Keshet', GLN 7290785400000).
import { createCerberusSource } from './cerberus.mjs';

const source = createCerberusSource({
  chainId: 'keshet',
  username: 'Keshet',
  chainGln: '7290785400000',
});

export const listFeeds = source.listFeeds;
