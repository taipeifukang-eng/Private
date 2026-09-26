type CatalogIdentity = {
  id?: string;
  code?: string | null;
  name?: string | null;
  brand?: string | null;
  model?: string | null;
};

function normalize(value?: string | null) {
  return (value || '').trim().toLocaleLowerCase().replace(/[\s\-_./]+/g, '');
}

export function findDuplicateEquipmentTemplate<T extends CatalogIdentity>(
  rows: T[],
  candidate: CatalogIdentity,
  excludeId?: string,
) {
  const name = normalize(candidate.name);
  const brand = normalize(candidate.brand);
  const model = normalize(candidate.model);
  return rows.find((row) => {
    if (excludeId && row.id === excludeId) return false;
    const rowModel = normalize(row.model);
    if (model && rowModel) {
      return model === rowModel && normalize(row.brand) === brand;
    }
    return !model && !rowModel && Boolean(name) && normalize(row.name) === name;
  });
}

export function findDuplicateFacilityTemplate<T extends CatalogIdentity>(
  rows: T[],
  candidate: CatalogIdentity,
  excludeId?: string,
) {
  const code = normalize(candidate.code);
  const name = normalize(candidate.name);
  const brand = normalize(candidate.brand);
  const model = normalize(candidate.model);
  return rows.find((row) => {
    if (excludeId && row.id === excludeId) return false;
    if (code && normalize(row.code) === code) return true;
    const rowModel = normalize(row.model);
    if (model && rowModel) {
      return model === rowModel && normalize(row.brand) === brand;
    }
    return !model && !rowModel && Boolean(name) && normalize(row.name) === name;
  });
}
