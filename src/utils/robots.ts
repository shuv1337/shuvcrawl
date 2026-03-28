export async function allowByRobots(_url: string, respectRobots: boolean): Promise<{ allowed: boolean; reason?: string }> {
  if (!respectRobots) return { allowed: true };
  return { allowed: true };
}
