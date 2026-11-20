// Official Yochananof (יוחננוף) Price Transparency adapter via Cerberus (username 'Yohananof', GLN 7290803800003).
import { createCerberusSource } from './cerberus.mjs';

const source = createCerberusSource({
  chainId: 'yochananof',
  username: 'Yohananof',
  chainGln: '7290803800003',
});

export const listFeeds = source.listFeeds;
