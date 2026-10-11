/** A text field's value from a submitted form, trimmed; empty when absent. */
export function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}
