// Official Rami Levy Price Transparency portal adapter (Cerberus web client at url.publishedprices.co.il).
import { createCerberusSource } from './cerberus.mjs';

const source = createCerberusSource({
  chainId: 'ramilevy',
  username: 'RamiLevi',
  chainGln: '7290058140886',
});

export const listFeeds = source.listFeeds;
