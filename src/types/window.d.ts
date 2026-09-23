import type { FinanceFlowApi } from './api';

export {};

declare global {
  interface Window {
    /**
     * Optional, because it genuinely is: `npm run dev` and the deployed demo
     * load the same bundle with no preload, and the storage layer checks for
     * this before using it. Declaring it non-optional would make that check
     * look like dead code and invite someone to delete it.
     */
    api?: FinanceFlowApi;
  }
}
