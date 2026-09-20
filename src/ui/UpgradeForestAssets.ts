export const UPGRADE_HEADER = {
  key: 'upgrade_forest_header',
  url: './assets/ui/upgrades/runtime/header.webp',
} as const;

export const UPGRADE_CATEGORY_FRAME = { key: 'upgrade_category_frame', url: './assets/ui/upgrades/runtime/category-frame.webp' } as const;
export const UPGRADE_XP_FRAME = { key: 'upgrade_xp_frame', url: './assets/ui/upgrades/runtime/xp-frame-v2.webp' } as const;
export const UPGRADE_APPLY = { key: 'upgrade_apply', url: './assets/ui/upgrades/runtime/apply-button-v2.webp' } as const;
export const UPGRADE_CONTROLS = [UPGRADE_CATEGORY_FRAME, UPGRADE_XP_FRAME, UPGRADE_APPLY] as const;
