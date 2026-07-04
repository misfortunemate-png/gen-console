const ERROR_LABEL = {
  invalid_schema: 'スキーマ不正',
  duplicate_category_id: 'カテゴリidの重複',
  duplicate_entry_id: 'エントリidの重複',
  unbalanced_braces: '括弧の対応不正',
  unknown_category_ref: '未知のカテゴリ参照',
  missing_wildcard: 'ワイルドカードファイルが存在しない',
  empty_wildcard: 'ワイルドカードファイルが空',
  no_axis: 'ラン軸カテゴリが選択されていない',
  multiple_axis: 'ラン軸カテゴリが複数選択されている',
};

// Position info only (category/entry id, field, char offset) — never renders
// prompt/preset body text, matching spec §12's log-position-only constraint
// extended here to the UI's own error surface for consistency.
export function formatValidationError(e) {
  const label = ERROR_LABEL[e.type] || e.type || '不明なエラー';
  const loc = [];
  if (e.categoryId) loc.push(`カテゴリ:${e.categoryId}`);
  if (e.entryId) loc.push(`エントリ:${e.entryId}`);
  if (e.field) loc.push(`項目:${e.field}`);
  if (e.name) loc.push(`wildcard:${e.name}`);
  if (typeof e.charOffset === 'number') loc.push(`位置:${e.charOffset}`);
  if (e.message) loc.push(e.message);
  return loc.length > 0 ? `${label}（${loc.join(' / ')}）` : label;
}
