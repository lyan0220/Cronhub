const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** 合法返回 null，否则返回中文错误文案。 */
export function validateRepo(v: string): string | null {
  if (!v.trim()) return "仓库不能为空";
  return REPO_RE.test(v.trim()) ? null : "格式应为 owner/repo";
}

/** 留空视为合法（inputs 是可选的）。 */
export function validateInputsJson(v: string): string | null {
  if (!v.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(v);
  } catch {
    return "不是合法的 JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "必须是 JSON 对象，不能是数组或基本类型";
  }
  return null;
}
