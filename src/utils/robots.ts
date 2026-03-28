// In-memory cache for robots.txt content keyed by origin
const robotsCache = new Map<string, { content: string; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface RobotsRule {
  userAgents: string[];
  disallows: string[];
  allows: string[];
}

function parseRobotsTxt(content: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  const lines = content.split('\n');
  let currentRule: RobotsRule | null = null;
  let sawDirectives = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) {
      if (currentRule && sawDirectives) {
        rules.push(currentRule);
        currentRule = null;
        sawDirectives = false;
      }
      continue;
    }
    if (line.startsWith('#')) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const directive = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (directive === 'user-agent') {
      if (!currentRule || sawDirectives) {
        if (currentRule) {
          rules.push(currentRule);
        }
        currentRule = {
          userAgents: [],
          disallows: [],
          allows: [],
        };
        sawDirectives = false;
      }

      currentRule.userAgents.push(value.toLowerCase());
    } else if (currentRule) {
      if (directive === 'disallow') {
        currentRule.disallows.push(value);
        sawDirectives = true;
      } else if (directive === 'allow') {
        currentRule.allows.push(value);
        sawDirectives = true;
      }
    }
  }

  if (currentRule) {
    rules.push(currentRule);
  }

  return rules;
}

function matchesUserAgent(userAgent: string, ruleUserAgent: string): boolean {
  if (ruleUserAgent === '*') return true;
  return userAgent.toLowerCase().includes(ruleUserAgent);
}

function matchDirectiveLength(path: string, directive: string): number | null {
  if (!directive) {
    return null;
  }

  if (directive === '/') {
    return 1;
  }

  return path.startsWith(directive) ? directive.length : null;
}

function isPathAllowed(path: string, rules: RobotsRule[], userAgent: string): { allowed: boolean; reason?: string } {
  const matchingRules = rules.filter(rule => rule.userAgents.some(agent => matchesUserAgent(userAgent, agent)));

  if (matchingRules.length === 0) {
    return { allowed: true };
  }

  const bestUserAgentLength = Math.max(
    ...matchingRules.flatMap(rule => rule.userAgents.filter(agent => matchesUserAgent(userAgent, agent)).map(agent => agent === '*' ? 0 : agent.length)),
  );

  const applicableRules = matchingRules.filter(rule =>
    rule.userAgents.some(agent => matchesUserAgent(userAgent, agent) && (agent === '*' ? 0 : agent.length) === bestUserAgentLength),
  );

  let bestMatch: { allowed: boolean; length: number; directive: string } | null = null;

  for (const rule of applicableRules) {
    for (const allow of rule.allows) {
      const length = matchDirectiveLength(path, allow);
      if (length == null) continue;
      if (!bestMatch || length > bestMatch.length || (length === bestMatch.length && bestMatch.allowed === false)) {
        bestMatch = { allowed: true, length, directive: allow };
      }
    }

    for (const disallow of rule.disallows) {
      const length = matchDirectiveLength(path, disallow);
      if (length == null) continue;
      if (!bestMatch || length > bestMatch.length) {
        bestMatch = { allowed: false, length, directive: disallow };
      }
    }
  }

  if (!bestMatch) {
    return { allowed: true };
  }

  if (bestMatch.allowed) {
    return { allowed: true };
  }

  return { allowed: false, reason: `robots.txt: Disallow ${bestMatch.directive}` };
}

async function fetchRobotsTxt(origin: string): Promise<string | null> {
  const cacheKey = origin;
  const now = Date.now();

  const cached = robotsCache.get(cacheKey);
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.content;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const robotsUrl = `${origin}/robots.txt`;
    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'shuvcrawl/1.0 (+https://github.com/shuv/shuvcrawl)',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        robotsCache.set(cacheKey, { content: '', cachedAt: now });
        return '';
      }
      return null;
    }

    const content = await response.text();
    robotsCache.set(cacheKey, { content, cachedAt: now });
    return content;
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function allowByRobots(
  url: string,
  respectRobots: boolean,
  userAgent = 'shuvcrawl',
): Promise<{ allowed: boolean; reason?: string }> {
  if (!respectRobots) {
    return { allowed: true };
  }

  try {
    const parsedUrl = new URL(url);
    const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;

    const robotsContent = await fetchRobotsTxt(origin);

    // If fetch failed, allow by convention
    if (robotsContent === null) {
      return { allowed: true };
    }

    // Empty robots.txt means allow all
    if (robotsContent === '') {
      return { allowed: true };
    }

    const rules = parseRobotsTxt(robotsContent);
    return isPathAllowed(parsedUrl.pathname, rules, userAgent);
  } catch (_error) {
    // URL parsing error or other issues - allow by default
    return { allowed: true };
  }
}

// For testing
export function clearRobotsCache(): void {
  robotsCache.clear();
}

export function getRobotsCacheSize(): number {
  return robotsCache.size;
}
