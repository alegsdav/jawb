/**
 * How a job is named on screen: "Company – Role" (an en dash with a space either side). Display only: the stored
 * title and company are not changed. An empty company shows the role alone; an empty role shows "Untitled role".
 */
export function jobLabel({ company, title }: { company: string; title: string }): string {
  const co = company.trim();
  const role = title.trim();
  if (!co && !role) return "Untitled role";
  if (!co) return role;
  return `${co} – ${role || "Untitled role"}`;
}
