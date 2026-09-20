import exports from './matchResultsExports.json';

export const MATCH_RESULTS_TITLE = {
  key: 'match_results_title',
  url: './assets/ui/match-results/' + exports.title.file,
} as const;

export const MATCH_RESULTS_BANNER = {
  key: 'match_results_banner',
  url: './assets/ui/match-results/' + exports.banner.file,
} as const;

export const MATCH_RESULTS_BACKGROUND = {
  key: 'match_results_background',
  url: './assets/ui/match-results/' + exports.background.file,
} as const;
