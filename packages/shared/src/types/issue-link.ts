export const LINK_TYPES = ['related', 'blocks', 'created_from'] as const;
export type LinkType = (typeof LINK_TYPES)[number];
