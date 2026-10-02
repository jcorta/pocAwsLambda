/** Política de contraseñas de Cognito (SPEC §7.4), validada también en el navegador para dar feedback antes. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("al menos 8 caracteres");
  if (!/[A-Z]/.test(password)) problems.push("una mayúscula");
  if (!/[a-z]/.test(password)) problems.push("una minúscula");
  if (!/\d/.test(password)) problems.push("un número");
  return problems;
}
