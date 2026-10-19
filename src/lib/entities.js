/** Normalize Base44 entity list/filter results (page object or raw array). */
export const itemsOf = (result) => {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.items)) return result.items;
  return [];
};
