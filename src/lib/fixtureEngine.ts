export type ConstraintSeverity = "hard" | "soft";

export type TeamTag = {
  bigThree: boolean;
  bigFour: boolean;
  championsLeague: boolean;
  europaLeague: boolean;
  conferenceLeague: boolean;
  sameStadiumGroup?: string;
};

export type Team = {
  id: string;
  name: string;
  city: string;
  isIstanbulTeam: boolean;
  tags: TeamTag;
  pot: number;
};

export type FixtureMatch = {
  week: number;
  homeTeamId: string;
  awayTeamId: string;
};

export type FixtureWeek = {
  weekNumber: number;
  matches: FixtureMatch[];
};

export type ConstraintResult = {
  id: string;
  name: string;
  passed: boolean;
  severity: ConstraintSeverity;
  explanation: string;
  affectedWeeks: number[];
  affectedTeams: string[];
};

export type ScheduleScore = {
  hardPenalty: number;
  softPenalty: number;
  totalPenalty: number;
  hardFailures: number;
  softFailures: number;
};

export type FixtureSchedule = {
  teams: Team[];
  weeks: FixtureWeek[];
  seed: string;
  drawNumbers: Record<string, number>;
  validationResults: ConstraintResult[];
  score?: ScheduleScore;
  attempts?: number;
  generationMode?: "exact-cover" | "circle-fallback";
};

export type DrawResult = {
  seed: string;
  teamsWithNumbers: Array<{
    team: Team;
    fixtureNumber: number;
  }>;
};

type RandomFn = () => number;
type HomeAwayPattern = {
  mask: number;
  bits: number[];
  text: string;
};

type FixedFirstHalfMatch = {
  weekIndex: number;
  homeTeamId: string;
  awayTeamId: string;
};

type FirstHalfRuleState = {
  bigFourOpponentMasks: Record<string, number>;
  bigFourHomeCounts: Record<string, number>;
  bigFourAwayCounts: Record<string, number>;
};

const FIRST_HALF_WEEKS = 17;
const TOTAL_WEEKS = 34;
const BIG_FOUR_TARGET_WEEKS = [4, 6, 8, 9, 13, 15];
const DERBY_FORBIDDEN_FULL_WEEKS = [1, 2, 11, 17, 18, 22, 28, 31];
const EUROPEAN_RESTRICTED_FULL_WEEKS = [1, 2, 8, 18, 22, 25, 28];
const EUROPEAN_RESTRICTED_GENERATION_FIRST_HALF = [
  ...new Set(EUROPEAN_RESTRICTED_FULL_WEEKS.map((week) => (week > FIRST_HALF_WEEKS ? week - FIRST_HALF_WEEKS : week))),
].sort((weekA, weekB) => weekA - weekB);
const FULL_MASK = (1 << FIRST_HALF_WEEKS) - 1;
const EXACT_COVER_NODE_CAP = 420_000;
const BIG_FOUR_WINDOW_WEEKS = 7;
const REGULAR_FOLLOW_SOFT_LIMIT = 5;
const TRABZONSPOR_ID = "trabzonspor";

const BIG_FOUR_TARGET_INDEXES = BIG_FOUR_TARGET_WEEKS.map((week) => week - 1);
const DERBY_FORBIDDEN_FULL_SET = new Set(DERBY_FORBIDDEN_FULL_WEEKS);
const EUROPEAN_RESTRICTED_GENERATION_FIRST_HALF_SET = new Set(EUROPEAN_RESTRICTED_GENERATION_FIRST_HALF);
const EUROPEAN_RESTRICTED_FULL_SET = new Set(EUROPEAN_RESTRICTED_FULL_WEEKS);

function hashSeed(seed: string | number): number {
  const input = String(seed);
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed: string | number): RandomFn {
  let state = hashSeed(seed) || 0x9e3779b9;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: RandomFn): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function pairKey(teamAId: string, teamBId: string): string {
  return teamAId < teamBId ? `${teamAId}|${teamBId}` : `${teamBId}|${teamAId}`;
}

function buildHomeAwayPatterns(): HomeAwayPattern[] {
  const patterns: HomeAwayPattern[] = [];

  for (let mask = 0; mask <= FULL_MASK; mask += 1) {
    const bits = Array.from({ length: FIRST_HALF_WEEKS }, (_, week) => (mask >> week) & 1);

    if (bits[0] === bits[1]) {
      continue;
    }

    if (bits[14] === bits[15] || bits[15] === bits[16]) {
      continue;
    }

    let consecutiveHome = 0;
    let consecutiveAway = 0;

    for (let week = 1; week < FIRST_HALF_WEEKS; week += 1) {
      if (bits[week] !== bits[week - 1]) {
        continue;
      }

      if (bits[week] === 1) {
        consecutiveHome += 1;
      } else {
        consecutiveAway += 1;
      }
    }

    if (consecutiveHome <= 1 && consecutiveAway <= 1) {
      patterns.push({
        mask,
        bits,
        text: bits.map((bit) => (bit === 1 ? "H" : "A")).join(""),
      });
    }
  }

  return patterns;
}

const HOME_AWAY_PATTERNS = buildHomeAwayPatterns();
const PATTERN_BY_MASK = new Map(HOME_AWAY_PATTERNS.map((pattern) => [pattern.mask, pattern]));
const COMPLEMENT_PATTERN_PAIRS = HOME_AWAY_PATTERNS.reduce<HomeAwayPattern[][]>((pairs, pattern) => {
  const complementMask = FULL_MASK ^ pattern.mask;
  const complement = PATTERN_BY_MASK.get(complementMask);

  if (!complement || pattern.mask > complementMask) {
    return pairs;
  }

  pairs.push([pattern, complement]);
  return pairs;
}, []);

const TARGET_WEEK_PERMUTATIONS = permute(BIG_FOUR_TARGET_INDEXES);

function permute<T>(items: T[]): T[][] {
  if (items.length === 0) {
    return [[]];
  }

  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permute(rest).map((permutation) => [item, ...permutation]);
  });
}

function bitCount(value: number): number {
  let count = 0;
  let copy = value;

  while (copy !== 0) {
    copy &= copy - 1;
    count += 1;
  }

  return count;
}

function getTeamMap(teams: Team[]): Map<string, Team> {
  return new Map(teams.map((team) => [team.id, team]));
}

function sortedByDrawNumber(teams: Team[], drawNumbers: Record<string, number>): Team[] {
  return [...teams].sort((teamA, teamB) => {
    const drawA = drawNumbers[teamA.id] ?? Number.MAX_SAFE_INTEGER;
    const drawB = drawNumbers[teamB.id] ?? Number.MAX_SAFE_INTEGER;
    return drawA - drawB || teamA.name.localeCompare(teamB.name);
  });
}

function isEuropeanRestrictedPair(teamA: Team, teamB: Team): boolean {
  const aChampions = teamA.tags.championsLeague;
  const bChampions = teamB.tags.championsLeague;
  const aOtherEurope = teamA.tags.europaLeague || teamA.tags.conferenceLeague;
  const bOtherEurope = teamB.tags.europaLeague || teamB.tags.conferenceLeague;

  return (aChampions && bOtherEurope) || (bChampions && aOtherEurope);
}

function isBigFourPair(teamA: Team, teamB: Team): boolean {
  return teamA.tags.bigFour && teamB.tags.bigFour;
}

function isBigThreePair(teamA: Team, teamB: Team): boolean {
  return teamA.tags.bigThree && teamB.tags.bigThree;
}

function createFirstHalfRuleState(teams: Team[]): FirstHalfRuleState {
  return {
    bigFourOpponentMasks: Object.fromEntries(teams.map((team) => [team.id, 0])),
    bigFourHomeCounts: Object.fromEntries(teams.map((team) => [team.id, 0])),
    bigFourAwayCounts: Object.fromEntries(teams.map((team) => [team.id, 0])),
  };
}

function getBigFourHomeAwayLimit(team: Team, opponent: Team): number {
  return team.id === TRABZONSPOR_ID && opponent.tags.bigThree ? 2 : 3;
}

function wouldCreateBigFourSpacingViolation(currentMask: number, weekIndex: number): boolean {
  const candidateMask = currentMask | (1 << weekIndex);
  const fullSeasonBigFourWeeks: number[] = [];

  for (let firstHalfWeekIndex = 0; firstHalfWeekIndex < FIRST_HALF_WEEKS; firstHalfWeekIndex += 1) {
    if ((candidateMask & (1 << firstHalfWeekIndex)) === 0) {
      continue;
    }

    fullSeasonBigFourWeeks.push(firstHalfWeekIndex + 1, firstHalfWeekIndex + 1 + FIRST_HALF_WEEKS);
  }

  fullSeasonBigFourWeeks.sort((weekA, weekB) => weekA - weekB);

  for (let index = 1; index < fullSeasonBigFourWeeks.length; index += 1) {
    if (fullSeasonBigFourWeeks[index] - fullSeasonBigFourWeeks[index - 1] === 1) {
      return true;
    }
  }

  for (let startWeek = 1; startWeek <= TOTAL_WEEKS - BIG_FOUR_WINDOW_WEEKS + 1; startWeek += 1) {
    const countInWindow = fullSeasonBigFourWeeks.filter(
      (week) => week >= startWeek && week < startWeek + BIG_FOUR_WINDOW_WEEKS,
    ).length;

    if (countInWindow > 2) {
      return true;
    }
  }

  return false;
}

function canApplyFirstHalfRuleMatch(homeTeam: Team, awayTeam: Team, weekIndex: number, state: FirstHalfRuleState): boolean {
  return canApplyTeamSide(homeTeam, awayTeam, true, weekIndex, state) && canApplyTeamSide(awayTeam, homeTeam, false, weekIndex, state);
}

function applyFirstHalfRuleMatch(homeTeam: Team, awayTeam: Team, weekIndex: number, state: FirstHalfRuleState, direction: 1 | -1): void {
  applyTeamSide(homeTeam, awayTeam, true, weekIndex, state, direction);
  applyTeamSide(awayTeam, homeTeam, false, weekIndex, state, direction);
}

function canApplyTeamSide(
  team: Team,
  opponent: Team,
  isHome: boolean,
  weekIndex: number,
  state: FirstHalfRuleState,
): boolean {
  if (!opponent.tags.bigFour) {
    return true;
  }

  const currentMask = state.bigFourOpponentMasks[team.id] ?? 0;

  if (wouldCreateBigFourSpacingViolation(currentMask, weekIndex)) {
    return false;
  }

  const currentCount = isHome ? state.bigFourHomeCounts[team.id] ?? 0 : state.bigFourAwayCounts[team.id] ?? 0;
  return currentCount + 1 <= getBigFourHomeAwayLimit(team, opponent);
}

function applyTeamSide(
  team: Team,
  opponent: Team,
  isHome: boolean,
  weekIndex: number,
  state: FirstHalfRuleState,
  direction: 1 | -1,
): void {
  if (!opponent.tags.bigFour) {
    return;
  }

  const weekMask = 1 << weekIndex;
  state.bigFourOpponentMasks[team.id] =
    direction === 1 ? (state.bigFourOpponentMasks[team.id] ?? 0) | weekMask : (state.bigFourOpponentMasks[team.id] ?? 0) & ~weekMask;

  const countMap = isHome ? state.bigFourHomeCounts : state.bigFourAwayCounts;
  countMap[team.id] = (countMap[team.id] ?? 0) + direction;
}

export function generateDrawNumbers(teams: Team[], seed: string): Record<string, number> {
  const rng = createSeededRandom(seed);
  const shuffledTeams = shuffle(teams, rng);

  return Object.fromEntries(shuffledTeams.map((team, index) => [team.id, index + 1]));
}

export function generateDrawResult(teams: Team[], seed: string): DrawResult {
  const drawNumbers = generateDrawNumbers(teams, seed);

  return {
    seed,
    teamsWithNumbers: sortedByDrawNumber(teams, drawNumbers).map((team) => ({
      team,
      fixtureNumber: drawNumbers[team.id],
    })),
  };
}

export function generateRoundRobinSchedule(
  teams: Team[],
  drawNumbers: Record<string, number>,
  seed: string,
): FixtureWeek[] {
  return generatePatternFirstHalf(teams, drawNumbers, seed) ?? generateCircleFallbackFirstHalf(teams, drawNumbers, seed);
}

export function mirrorSecondHalf(firstHalf: FixtureWeek[]): FixtureWeek[] {
  return firstHalf.map((week) => ({
    weekNumber: week.weekNumber + FIRST_HALF_WEEKS,
    matches: week.matches.map((match) => ({
      week: match.week + FIRST_HALF_WEEKS,
      homeTeamId: match.awayTeamId,
      awayTeamId: match.homeTeamId,
    })),
  }));
}

export function generateBestSchedule(teams: Team[], seed: string, maxAttempts: number): FixtureSchedule {
  const attempts = Math.max(1, Math.floor(maxAttempts));
  let bestSchedule: FixtureSchedule | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptSeed = `${seed}:attempt:${attempt}`;
    const drawNumbers = generateDrawNumbers(teams, `${seed}:draw:${attempt}`);
    const exactFirstHalf = generatePatternFirstHalf(teams, drawNumbers, attemptSeed);
    const firstHalf = exactFirstHalf ?? generateCircleFallbackFirstHalf(teams, drawNumbers, attemptSeed);
    const weeks = [...firstHalf, ...mirrorSecondHalf(firstHalf)];
    const schedule: FixtureSchedule = {
      teams: teams.map((team) => ({ ...team, tags: { ...team.tags } })),
      weeks,
      seed,
      drawNumbers,
      validationResults: [],
      attempts: attempt + 1,
      generationMode: exactFirstHalf ? "exact-cover" : "circle-fallback",
    };

    schedule.validationResults = validateSchedule(schedule);
    schedule.score = scoreSchedule(schedule);

    if (!bestSchedule || schedule.score.totalPenalty < (bestSchedule.score?.totalPenalty ?? Number.POSITIVE_INFINITY)) {
      bestSchedule = schedule;
    }

    if (schedule.score.hardFailures === 0) {
      return schedule;
    }
  }

  return bestSchedule!;
}

function generatePatternFirstHalf(
  teams: Team[],
  drawNumbers: Record<string, number>,
  seed: string,
): FixtureWeek[] | null {
  if (teams.length !== 18 || COMPLEMENT_PATTERN_PAIRS.length === 0) {
    return null;
  }

  const rng = createSeededRandom(seed);
  const patternAssignment = assignHomeAwayPatterns(teams, drawNumbers, rng);

  if (!patternAssignment) {
    return null;
  }

  return solveFirstHalfExactCover(
    teams,
    patternAssignment.patternsByTeamId,
    patternAssignment.fixedMatches,
    `${seed}:exact-cover`,
  );
}

function assignHomeAwayPatterns(
  teams: Team[],
  drawNumbers: Record<string, number>,
  rng: RandomFn,
): { patternsByTeamId: Record<string, HomeAwayPattern>; fixedMatches: FixedFirstHalfMatch[] } | null {
  const drawOrderedTeams = sortedByDrawNumber(teams, drawNumbers);
  const teamPairs = buildComplementTeamPairs(drawOrderedTeams, rng);

  if (teamPairs.length !== teams.length / 2) {
    return null;
  }

  const patternPairs = shuffle(COMPLEMENT_PATTERN_PAIRS, rng).slice(0, teamPairs.length);
  const patternsByTeamId: Record<string, HomeAwayPattern> = {};

  teamPairs.forEach(([teamA, teamB], index) => {
    const [patternA, patternB] = patternPairs[index];

    if (rng() < 0.5) {
      patternsByTeamId[teamA.id] = patternA;
      patternsByTeamId[teamB.id] = patternB;
    } else {
      patternsByTeamId[teamA.id] = patternB;
      patternsByTeamId[teamB.id] = patternA;
    }
  });

  if (!validatePatternGroupLimits(teams, patternsByTeamId)) {
    return null;
  }

  const fixedMatches = assignBigFourTargetWeeks(teams, patternsByTeamId, rng);

  if (!fixedMatches) {
    return null;
  }

  return { patternsByTeamId, fixedMatches };
}

function buildComplementTeamPairs(drawOrderedTeams: Team[], rng: RandomFn): Team[][] {
  const usedTeamIds = new Set<string>();
  const pairs: Team[][] = [];

  const addPair = (teamA?: Team, teamB?: Team): boolean => {
    if (!teamA || !teamB || teamA.id === teamB.id) {
      return false;
    }

    if (usedTeamIds.has(teamA.id) || usedTeamIds.has(teamB.id)) {
      return false;
    }

    usedTeamIds.add(teamA.id);
    usedTeamIds.add(teamB.id);
    pairs.push([teamA, teamB]);
    return true;
  };

  const bigThreeTeams = drawOrderedTeams.filter((team) => team.tags.bigThree);
  const istanbulTeams = drawOrderedTeams.filter((team) => team.isIstanbulTeam);
  const sameStadiumGroups = new Map<string, Team[]>();

  for (const team of drawOrderedTeams) {
    if (!team.tags.sameStadiumGroup) {
      continue;
    }

    const group = sameStadiumGroups.get(team.tags.sameStadiumGroup) ?? [];
    group.push(team);
    sameStadiumGroups.set(team.tags.sameStadiumGroup, group);
  }

  for (const groupTeams of sameStadiumGroups.values()) {
    for (let index = 0; index + 1 < groupTeams.length; index += 2) {
      addPair(groupTeams[index], groupTeams[index + 1]);
    }
  }

  addPair(bigThreeTeams[0], bigThreeTeams[1]);

  const thirdBigThree = bigThreeTeams.find((team) => !usedTeamIds.has(team.id));
  const availableIstanbulPartner = istanbulTeams.find((team) => !usedTeamIds.has(team.id) && team.id !== thirdBigThree?.id);
  addPair(thirdBigThree, availableIstanbulPartner);

  const remainingIstanbulTeams = shuffle(
    istanbulTeams.filter((team) => !usedTeamIds.has(team.id)),
    rng,
  );

  for (let index = 0; index + 1 < remainingIstanbulTeams.length; index += 2) {
    addPair(remainingIstanbulTeams[index], remainingIstanbulTeams[index + 1]);
  }

  const remainingTeams = shuffle(
    drawOrderedTeams.filter((team) => !usedTeamIds.has(team.id)),
    rng,
  );

  for (let index = 0; index + 1 < remainingTeams.length; index += 2) {
    addPair(remainingTeams[index], remainingTeams[index + 1]);
  }

  return pairs;
}

function validatePatternGroupLimits(teams: Team[], patternsByTeamId: Record<string, HomeAwayPattern>): boolean {
  const sameStadiumGroups = new Map<string, Team[]>();

  for (const team of teams) {
    if (!team.tags.sameStadiumGroup) {
      continue;
    }

    const group = sameStadiumGroups.get(team.tags.sameStadiumGroup) ?? [];
    group.push(team);
    sameStadiumGroups.set(team.tags.sameStadiumGroup, group);
  }

  for (let weekIndex = 0; weekIndex < FIRST_HALF_WEEKS; weekIndex += 1) {
    const homeTeams = teams.filter((team) => patternsByTeamId[team.id]?.bits[weekIndex] === 1);
    const bigThreeHomeCount = homeTeams.filter((team) => team.tags.bigThree).length;
    const istanbulHomeCount = homeTeams.filter((team) => team.isIstanbulTeam).length;

    if (homeTeams.length !== teams.length / 2 || bigThreeHomeCount > 2 || istanbulHomeCount > 4) {
      return false;
    }

    for (const groupTeams of sameStadiumGroups.values()) {
      const homeInGroup = groupTeams.filter((team) => patternsByTeamId[team.id]?.bits[weekIndex] === 1);

      if (homeInGroup.length > 1) {
        return false;
      }
    }
  }

  return true;
}

function assignBigFourTargetWeeks(
  teams: Team[],
  patternsByTeamId: Record<string, HomeAwayPattern>,
  rng: RandomFn,
): FixedFirstHalfMatch[] | null {
  const bigFourTeams = teams.filter((team) => team.tags.bigFour);

  if (bigFourTeams.length !== 4) {
    return [];
  }

  const bigFourPairs: Array<[Team, Team]> = [];

  for (let firstIndex = 0; firstIndex < bigFourTeams.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < bigFourTeams.length; secondIndex += 1) {
      bigFourPairs.push([bigFourTeams[firstIndex], bigFourTeams[secondIndex]]);
    }
  }

  for (const weekIndexes of shuffle(TARGET_WEEK_PERMUTATIONS, rng)) {
    const fixedMatches: FixedFirstHalfMatch[] = [];
    const derbyHomeCount = new Map<string, number>();
    const derbyAwayCount = new Map<string, number>();
    let possible = true;

    for (let pairIndex = 0; pairIndex < bigFourPairs.length; pairIndex += 1) {
      const [teamA, teamB] = bigFourPairs[pairIndex];
      const weekIndex = weekIndexes[pairIndex];
      const teamAPattern = patternsByTeamId[teamA.id];
      const teamBPattern = patternsByTeamId[teamB.id];

      if (!teamAPattern || !teamBPattern || teamAPattern.bits[weekIndex] === teamBPattern.bits[weekIndex]) {
        possible = false;
        break;
      }

      if (EUROPEAN_RESTRICTED_GENERATION_FIRST_HALF_SET.has(weekIndex + 1) && isEuropeanRestrictedPair(teamA, teamB)) {
        possible = false;
        break;
      }

      const homeTeam = teamAPattern.bits[weekIndex] === 1 ? teamA : teamB;
      const awayTeam = homeTeam.id === teamA.id ? teamB : teamA;
      fixedMatches.push({
        weekIndex,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
      });

      if (isBigThreePair(teamA, teamB)) {
        derbyHomeCount.set(homeTeam.id, (derbyHomeCount.get(homeTeam.id) ?? 0) + 1);
        derbyAwayCount.set(awayTeam.id, (derbyAwayCount.get(awayTeam.id) ?? 0) + 1);
      }
    }

    const bigThreeTeams = teams.filter((team) => team.tags.bigThree);

    if (possible && bigThreeTeams.length === 3) {
      possible = bigThreeTeams.every(
        (team) => (derbyHomeCount.get(team.id) ?? 0) === 1 && (derbyAwayCount.get(team.id) ?? 0) === 1,
      );
    }

    if (possible) {
      return fixedMatches;
    }
  }

  return null;
}

function solveFirstHalfExactCover(
  teams: Team[],
  patternsByTeamId: Record<string, HomeAwayPattern>,
  fixedMatches: FixedFirstHalfMatch[],
  seed: string,
): FixtureWeek[] | null {
  const rng = createSeededRandom(seed);
  const teamIndexes = new Map(teams.map((team, index) => [team.id, index]));
  const teamBusyMasks = Array.from({ length: teams.length }, () => 0);
  const fixedPairKeys = new Set<string>();
  const matchesByWeek = Array.from({ length: FIRST_HALF_WEEKS }, () => [] as FixtureMatch[]);

  for (const fixedMatch of fixedMatches) {
    const homeIndex = teamIndexes.get(fixedMatch.homeTeamId);
    const awayIndex = teamIndexes.get(fixedMatch.awayTeamId);

    if (homeIndex === undefined || awayIndex === undefined) {
      return null;
    }

    const weekMask = 1 << fixedMatch.weekIndex;

    if ((teamBusyMasks[homeIndex] & weekMask) !== 0 || (teamBusyMasks[awayIndex] & weekMask) !== 0) {
      return null;
    }

    teamBusyMasks[homeIndex] |= weekMask;
    teamBusyMasks[awayIndex] |= weekMask;
    fixedPairKeys.add(pairKey(fixedMatch.homeTeamId, fixedMatch.awayTeamId));
    matchesByWeek[fixedMatch.weekIndex].push({
      week: fixedMatch.weekIndex + 1,
      homeTeamId: fixedMatch.homeTeamId,
      awayTeamId: fixedMatch.awayTeamId,
    });
  }

  const pairDomains: Array<{
    firstTeamIndex: number;
    secondTeamIndex: number;
    firstTeam: Team;
    secondTeam: Team;
    domainMask: number;
  }> = [];

  for (let firstIndex = 0; firstIndex < teams.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < teams.length; secondIndex += 1) {
      const firstTeam = teams[firstIndex];
      const secondTeam = teams[secondIndex];

      if (fixedPairKeys.has(pairKey(firstTeam.id, secondTeam.id))) {
        continue;
      }

      let domainMask = 0;

      for (let weekIndex = 0; weekIndex < FIRST_HALF_WEEKS; weekIndex += 1) {
        const firstPattern = patternsByTeamId[firstTeam.id];
        const secondPattern = patternsByTeamId[secondTeam.id];

        if (!firstPattern || !secondPattern || firstPattern.bits[weekIndex] === secondPattern.bits[weekIndex]) {
          continue;
        }

        if (EUROPEAN_RESTRICTED_GENERATION_FIRST_HALF_SET.has(weekIndex + 1) && isEuropeanRestrictedPair(firstTeam, secondTeam)) {
          continue;
        }

        if (isBigFourPair(firstTeam, secondTeam)) {
          continue;
        }

        domainMask |= 1 << weekIndex;
      }

      if (domainMask === 0) {
        return null;
      }

      pairDomains.push({
        firstTeamIndex: firstIndex,
        secondTeamIndex: secondIndex,
        firstTeam,
        secondTeam,
        domainMask,
      });
    }
  }

  const unassignedPairIndexes = new Set(pairDomains.map((_, index) => index));
  const solution: FixtureMatch[] = [];
  let visitedNodes = 0;

  const recurse = (): boolean => {
    visitedNodes += 1;

    if (visitedNodes > EXACT_COVER_NODE_CAP) {
      return false;
    }

    if (unassignedPairIndexes.size === 0) {
      return true;
    }

    let selectedPairIndex = -1;
    let selectedFeasibleMask = 0;
    let selectedFeasibleCount = Number.POSITIVE_INFINITY;

    for (const pairIndex of unassignedPairIndexes) {
      const pair = pairDomains[pairIndex];
      const feasibleMask =
        pair.domainMask & ~teamBusyMasks[pair.firstTeamIndex] & ~teamBusyMasks[pair.secondTeamIndex];
      const feasibleCount = bitCount(feasibleMask);

      if (feasibleCount === 0) {
        return false;
      }

      if (feasibleCount < selectedFeasibleCount || (feasibleCount === selectedFeasibleCount && rng() < 0.12)) {
        selectedPairIndex = pairIndex;
        selectedFeasibleMask = feasibleMask;
        selectedFeasibleCount = feasibleCount;
      }
    }

    const selectedPair = pairDomains[selectedPairIndex];
    let candidateWeekIndexes: number[] = [];

    for (let weekIndex = 0; weekIndex < FIRST_HALF_WEEKS; weekIndex += 1) {
      if ((selectedFeasibleMask & (1 << weekIndex)) !== 0) {
        candidateWeekIndexes.push(weekIndex);
      }
    }

    candidateWeekIndexes = shuffle(candidateWeekIndexes, rng).sort((weekA, weekB) => {
      const busyA = teamBusyMasks.filter((mask) => (mask & (1 << weekA)) !== 0).length;
      const busyB = teamBusyMasks.filter((mask) => (mask & (1 << weekB)) !== 0).length;
      return busyB - busyA;
    });

    unassignedPairIndexes.delete(selectedPairIndex);

    for (const weekIndex of candidateWeekIndexes) {
      const weekMask = 1 << weekIndex;
      teamBusyMasks[selectedPair.firstTeamIndex] |= weekMask;
      teamBusyMasks[selectedPair.secondTeamIndex] |= weekMask;

      const firstIsHome = patternsByTeamId[selectedPair.firstTeam.id].bits[weekIndex] === 1;
      const homeTeam = firstIsHome ? selectedPair.firstTeam : selectedPair.secondTeam;
      const awayTeam = firstIsHome ? selectedPair.secondTeam : selectedPair.firstTeam;
      const match: FixtureMatch = {
        week: weekIndex + 1,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
      };

      solution.push(match);

      if (recurse()) {
        return true;
      }

      solution.pop();
      teamBusyMasks[selectedPair.firstTeamIndex] &= ~weekMask;
      teamBusyMasks[selectedPair.secondTeamIndex] &= ~weekMask;
    }

    unassignedPairIndexes.add(selectedPairIndex);
    return false;
  };

  if (!recurse()) {
    return null;
  }

  for (const match of solution) {
    matchesByWeek[match.week - 1].push(match);
  }

  return matchesByWeek.map((matches, weekIndex) => ({
    weekNumber: weekIndex + 1,
    matches: [...matches].sort((matchA, matchB) => matchA.homeTeamId.localeCompare(matchB.homeTeamId)),
  }));
}

function generateCircleFallbackFirstHalf(
  teams: Team[],
  drawNumbers: Record<string, number>,
  seed: string,
): FixtureWeek[] {
  const rng = createSeededRandom(seed);
  const orderedTeams = sortedByDrawNumber(teams, drawNumbers);
  const hasBye = orderedTeams.length % 2 === 1;
  const rotation = hasBye ? [...orderedTeams, null] : [...orderedTeams];
  const rounds = rotation.length - 1;
  const matchesPerRound = rotation.length / 2;
  const weeks: FixtureWeek[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const matches: FixtureMatch[] = [];

    for (let slot = 0; slot < matchesPerRound; slot += 1) {
      const teamA = rotation[slot];
      const teamB = rotation[rotation.length - 1 - slot];

      if (!teamA || !teamB) {
        continue;
      }

      const flip = rng() < 0.5;
      const homeTeam = flip ? teamB : teamA;
      const awayTeam = flip ? teamA : teamB;
      matches.push({
        week: round + 1,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
      });
    }

    weeks.push({
      weekNumber: round + 1,
      matches,
    });

    rotation.splice(1, 0, rotation.pop()!);
  }

  return weeks;
}

export function validateSchedule(schedule: FixtureSchedule): ConstraintResult[] {
  const teamsById = getTeamMap(schedule.teams);
  const teamIds = schedule.teams.map((team) => team.id);
  const results: ConstraintResult[] = [];

  results.push(validateSymmetricFixture(schedule));
  results.push(validateBasicRoundRobin(schedule));
  results.push(validateHomeAwaySequences(schedule));
  results.push(validateRegularFollower(schedule));
  results.push(validateBigFourOpponentDistribution(schedule));
  results.push(validateBigFourOpponentSpacing(schedule));
  results.push(validateBigThreeHomeLimit(schedule));
  results.push(validateBigThreeDerbyBalance(schedule));
  results.push(validateDerbyForbiddenWeeks(schedule));
  results.push(validateBigFourWeeks(schedule));
  results.push(validateEuropeanRestriction(schedule));
  results.push(validateIstanbulHomeLimit(schedule));
  results.push(validateIstanbulCityPresence(schedule));
  results.push(validateSameStadium(schedule));

  return results.map((result) => ({
    ...result,
    affectedWeeks: uniqueNumbers(result.affectedWeeks).sort((a, b) => a - b),
    affectedTeams: uniqueStrings(result.affectedTeams)
      .map((teamId) => teamsById.get(teamId)?.name ?? teamId)
      .sort((a, b) => a.localeCompare(b)),
  }));

  function validateSymmetricFixture(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];

    for (let week = 1; week <= FIRST_HALF_WEEKS; week += 1) {
      const firstHalfWeek = currentSchedule.weeks.find((entry) => entry.weekNumber === week);
      const secondHalfWeek = currentSchedule.weeks.find((entry) => entry.weekNumber === week + FIRST_HALF_WEEKS);

      if (!firstHalfWeek || !secondHalfWeek) {
        affectedWeeks.push(week, week + FIRST_HALF_WEEKS);
        continue;
      }

      for (const match of firstHalfWeek.matches) {
        const mirrorExists = secondHalfWeek.matches.some(
          (secondMatch) =>
            secondMatch.homeTeamId === match.awayTeamId && secondMatch.awayTeamId === match.homeTeamId,
        );

        if (!mirrorExists) {
          affectedWeeks.push(week, week + FIRST_HALF_WEEKS);
          affectedTeams.push(match.homeTeamId, match.awayTeamId);
        }
      }
    }

    return {
      id: "symmetric_fixture",
      name: "Symmetric fixture",
      passed: affectedWeeks.length === 0,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0
          ? "Weeks 18-34 reverse the home and away sides from weeks 1-17."
          : "At least one first-half match is missing its reversed second-half mirror.",
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateBasicRoundRobin(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];
    const pairCounts = new Map<string, number>();
    const pairHomeCounts = new Map<string, Map<string, number>>();
    const homeCounts = new Map(teamIds.map((teamId) => [teamId, 0]));
    const awayCounts = new Map(teamIds.map((teamId) => [teamId, 0]));

    for (const week of currentSchedule.weeks) {
      const teamsSeenThisWeek = new Set<string>();

      if (week.matches.length !== schedule.teams.length / 2) {
        affectedWeeks.push(week.weekNumber);
      }

      for (const match of week.matches) {
        if (match.homeTeamId === match.awayTeamId) {
          affectedWeeks.push(week.weekNumber);
          affectedTeams.push(match.homeTeamId);
        }

        if (teamsSeenThisWeek.has(match.homeTeamId) || teamsSeenThisWeek.has(match.awayTeamId)) {
          affectedWeeks.push(week.weekNumber);
          affectedTeams.push(match.homeTeamId, match.awayTeamId);
        }

        teamsSeenThisWeek.add(match.homeTeamId);
        teamsSeenThisWeek.add(match.awayTeamId);
        homeCounts.set(match.homeTeamId, (homeCounts.get(match.homeTeamId) ?? 0) + 1);
        awayCounts.set(match.awayTeamId, (awayCounts.get(match.awayTeamId) ?? 0) + 1);

        const key = pairKey(match.homeTeamId, match.awayTeamId);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        const homeMap = pairHomeCounts.get(key) ?? new Map<string, number>();
        homeMap.set(match.homeTeamId, (homeMap.get(match.homeTeamId) ?? 0) + 1);
        pairHomeCounts.set(key, homeMap);
      }

      if (teamsSeenThisWeek.size !== schedule.teams.length) {
        affectedWeeks.push(week.weekNumber);
      }
    }

    for (let firstIndex = 0; firstIndex < teamIds.length; firstIndex += 1) {
      const firstTeamId = teamIds[firstIndex];

      if ((homeCounts.get(firstTeamId) ?? 0) !== FIRST_HALF_WEEKS || (awayCounts.get(firstTeamId) ?? 0) !== FIRST_HALF_WEEKS) {
        affectedTeams.push(firstTeamId);
      }

      for (let secondIndex = firstIndex + 1; secondIndex < teamIds.length; secondIndex += 1) {
        const secondTeamId = teamIds[secondIndex];
        const key = pairKey(firstTeamId, secondTeamId);
        const homeMap = pairHomeCounts.get(key);

        if (
          (pairCounts.get(key) ?? 0) !== 2 ||
          (homeMap?.get(firstTeamId) ?? 0) !== 1 ||
          (homeMap?.get(secondTeamId) ?? 0) !== 1
        ) {
          affectedTeams.push(firstTeamId, secondTeamId);
        }
      }
    }

    return {
      id: "basic_round_robin",
      name: "Basic round-robin validity",
      passed: affectedWeeks.length === 0 && affectedTeams.length === 0 && currentSchedule.weeks.length === TOTAL_WEEKS,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0 && affectedTeams.length === 0 && currentSchedule.weeks.length === TOTAL_WEEKS
          ? "Every team plays once per week, every pair plays home and away, and every team has 17 home and 17 away matches."
          : "The schedule has a duplicate, missing pairing, weekly conflict, self-match, or home/away count issue.",
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateHomeAwaySequences(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];
    const explanations: string[] = [];

    for (const team of currentSchedule.teams) {
      const sequence = buildHomeAwaySequence(currentSchedule, team.id);

      if (sequence.length !== TOTAL_WEEKS || sequence.some((entry) => entry === "?")) {
        affectedTeams.push(team.id);
        continue;
      }

      if (sequence[0] === sequence[1]) {
        affectedTeams.push(team.id);
        affectedWeeks.push(1, 2);
      }

      if (sequence[31] === sequence[32]) {
        affectedTeams.push(team.id);
        affectedWeeks.push(32, 33);
      }

      if (sequence[32] === sequence[33]) {
        affectedTeams.push(team.id);
        affectedWeeks.push(33, 34);
      }

      const firstHalfBreaks = countSequenceBreaks(sequence.slice(0, FIRST_HALF_WEEKS));
      const secondHalfBreaks = countSequenceBreaks(sequence.slice(FIRST_HALF_WEEKS));

      if (firstHalfBreaks.home > 1 || firstHalfBreaks.away > 1) {
        affectedTeams.push(team.id);
        explanations.push(`${team.name}: first half has ${firstHalfBreaks.home} HH and ${firstHalfBreaks.away} AA runs`);
      }

      if (secondHalfBreaks.home > 1 || secondHalfBreaks.away > 1) {
        affectedTeams.push(team.id);
        explanations.push(`${team.name}: second half has ${secondHalfBreaks.home} HH and ${secondHalfBreaks.away} AA runs`);
      }
    }

    return {
      id: "home_away_sequences",
      name: "Home/away sequence limits",
      passed: affectedTeams.length === 0,
      severity: "hard",
      explanation:
        affectedTeams.length === 0
          ? "The first two weeks, final three weeks, and per-half repeated home/away limits are satisfied."
          : `One or more home/away sequence limits failed. ${explanations.slice(0, 4).join("; ")}`,
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateRegularFollower(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];
    const explanations: string[] = [];
    const opponentByTeamId = new Map<string, string[]>();
    const sortedWeeks = [...currentSchedule.weeks].sort((weekA, weekB) => weekA.weekNumber - weekB.weekNumber);

    for (const teamId of teamIds) {
      opponentByTeamId.set(
        teamId,
        sortedWeeks.map((week) => {
          const match = week.matches.find((entry) => entry.homeTeamId === teamId || entry.awayTeamId === teamId);

          if (!match) {
            return "";
          }

          return match.homeTeamId === teamId ? match.awayTeamId : match.homeTeamId;
        }),
      );
    }

    for (const leaderId of teamIds) {
      const leaderOpponents = opponentByTeamId.get(leaderId) ?? [];

      for (const followerId of teamIds) {
        if (leaderId === followerId) {
          continue;
        }

        const followerOpponents = opponentByTeamId.get(followerId) ?? [];
        const followedWeeks: number[] = [];

        for (let weekIndex = 1; weekIndex < TOTAL_WEEKS; weekIndex += 1) {
          if (followerOpponents[weekIndex] && followerOpponents[weekIndex] === leaderOpponents[weekIndex - 1]) {
            followedWeeks.push(weekIndex + 1);
          }
        }

        if (followedWeeks.length > REGULAR_FOLLOW_SOFT_LIMIT) {
          affectedTeams.push(leaderId, followerId);
          affectedWeeks.push(...followedWeeks);
          explanations.push(
            `${teamsById.get(followerId)?.name ?? followerId} follows ${teamsById.get(leaderId)?.name ?? leaderId} ${followedWeeks.length} times`,
          );
        }
      }
    }

    return {
      id: "regular_follower",
      name: "No regular team following",
      passed: affectedTeams.length === 0,
      severity: "soft",
      explanation:
        affectedTeams.length === 0
          ? "No team repeatedly follows another team's opponent path above the transparent soft limit."
          : `A team appears to regularly follow another team's opponent path. ${explanations.slice(0, 3).join("; ")}`,
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateBigFourOpponentDistribution(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];
    const explanations: string[] = [];

    for (const team of currentSchedule.teams) {
      for (const halfStartWeek of [1, FIRST_HALF_WEEKS + 1]) {
        let homeAgainstBigFour = 0;
        let awayAgainstBigFour = 0;
        let trabzonHomeAgainstBigThree = 0;
        let trabzonAwayAgainstBigThree = 0;
        const violatingWeeks: number[] = [];

        for (const week of currentSchedule.weeks.filter(
          (entry) => entry.weekNumber >= halfStartWeek && entry.weekNumber < halfStartWeek + FIRST_HALF_WEEKS,
        )) {
          const match = week.matches.find((entry) => entry.homeTeamId === team.id || entry.awayTeamId === team.id);

          if (!match) {
            continue;
          }

          const isHome = match.homeTeamId === team.id;
          const opponent = teamsById.get(isHome ? match.awayTeamId : match.homeTeamId);

          if (!opponent?.tags.bigFour) {
            continue;
          }

          if (isHome) {
            homeAgainstBigFour += 1;
          } else {
            awayAgainstBigFour += 1;
          }

          if (team.id === TRABZONSPOR_ID && opponent.tags.bigThree) {
            if (isHome) {
              trabzonHomeAgainstBigThree += 1;
            } else {
              trabzonAwayAgainstBigThree += 1;
            }
          }

          violatingWeeks.push(week.weekNumber);
        }

        if (homeAgainstBigFour > 3 || awayAgainstBigFour > 3) {
          affectedTeams.push(team.id);
          affectedWeeks.push(...violatingWeeks);
          explanations.push(`${team.name}: ${homeAgainstBigFour} home / ${awayAgainstBigFour} away vs big four`);
        }

        if (team.id === TRABZONSPOR_ID && (trabzonHomeAgainstBigThree > 2 || trabzonAwayAgainstBigThree > 2)) {
          affectedTeams.push(team.id);
          affectedWeeks.push(...violatingWeeks);
          explanations.push(
            `${team.name}: ${trabzonHomeAgainstBigThree} home / ${trabzonAwayAgainstBigThree} away vs GS-FB-BJK`,
          );
        }
      }
    }

    return {
      id: "big_four_opponent_distribution",
      name: "Big-four opponent home/away distribution",
      passed: affectedTeams.length === 0,
      severity: "soft",
      explanation:
        affectedTeams.length === 0
          ? "In each half, no team has more than three home or away matches against the big four; Trabzonspor is capped at two against GS-FB-BJK."
          : `One or more big-four home/away distribution limits failed. ${explanations.slice(0, 4).join("; ")}`,
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateBigFourOpponentSpacing(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];
    const explanations: string[] = [];

    for (const team of currentSchedule.teams) {
      const bigFourWeeks = currentSchedule.weeks
        .filter((week) => {
          const match = week.matches.find((entry) => entry.homeTeamId === team.id || entry.awayTeamId === team.id);

          if (!match) {
            return false;
          }

          const opponentId = match.homeTeamId === team.id ? match.awayTeamId : match.homeTeamId;
          return teamsById.get(opponentId)?.tags.bigFour ?? false;
        })
        .map((week) => week.weekNumber)
        .sort((weekA, weekB) => weekA - weekB);

      for (let index = 1; index < bigFourWeeks.length; index += 1) {
        if (bigFourWeeks[index] - bigFourWeeks[index - 1] === 1) {
          affectedTeams.push(team.id);
          affectedWeeks.push(bigFourWeeks[index - 1], bigFourWeeks[index]);
          explanations.push(`${team.name}: consecutive weeks ${bigFourWeeks[index - 1]}-${bigFourWeeks[index]}`);
        }
      }

      for (let startWeek = 1; startWeek <= TOTAL_WEEKS - BIG_FOUR_WINDOW_WEEKS + 1; startWeek += 1) {
        const weeksInWindow = bigFourWeeks.filter((week) => week >= startWeek && week < startWeek + BIG_FOUR_WINDOW_WEEKS);

        if (weeksInWindow.length > 2) {
          affectedTeams.push(team.id);
          affectedWeeks.push(...weeksInWindow);
          explanations.push(`${team.name}: ${weeksInWindow.length} big-four matches in weeks ${startWeek}-${startWeek + 6}`);
        }
      }
    }

    return {
      id: "big_four_opponent_spacing",
      name: "Big-four opponent spacing",
      passed: affectedTeams.length === 0,
      severity: "soft",
      explanation:
        affectedTeams.length === 0
          ? "No team plays the big four in consecutive weeks or three times in any seven-week window."
          : `A team has too dense a run against the big four. ${explanations.slice(0, 4).join("; ")}`,
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateBigThreeHomeLimit(currentSchedule: FixtureSchedule): ConstraintResult {
    const bigThreeIds = currentSchedule.teams.filter((team) => team.tags.bigThree).map((team) => team.id);
    const affectedWeeks: number[] = [];

    for (const week of currentSchedule.weeks) {
      const homeCount = week.matches.filter((match) => bigThreeIds.includes(match.homeTeamId)).length;

      if (homeCount > 2) {
        affectedWeeks.push(week.weekNumber);
      }
    }

    return {
      id: "big_three_home_limit",
      name: "Big three home limit",
      passed: affectedWeeks.length === 0,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0
          ? "At most two of Galatasaray, Fenerbahçe and Beşiktaş are home in every week."
          : "More than two big-three teams are home in at least one week.",
      affectedWeeks,
      affectedTeams: affectedWeeks.length > 0 ? bigThreeIds : [],
    };
  }

  function validateBigThreeDerbyBalance(currentSchedule: FixtureSchedule): ConstraintResult {
    const bigThreeTeams = currentSchedule.teams.filter((team) => team.tags.bigThree);
    const affectedTeams: string[] = [];
    const firstHalf = currentSchedule.weeks.filter((week) => week.weekNumber <= FIRST_HALF_WEEKS);

    if (bigThreeTeams.length !== 3) {
      return {
        id: "big_three_derby_balance",
        name: "Big three derby balance",
        passed: false,
        severity: "hard",
        explanation: `Expected exactly 3 big-three teams, found ${bigThreeTeams.length}.`,
        affectedWeeks: [],
        affectedTeams: bigThreeTeams.map((team) => team.id),
      };
    }

    for (const team of bigThreeTeams) {
      let homeDerbies = 0;
      let awayDerbies = 0;

      for (const week of firstHalf) {
        for (const match of week.matches) {
          const homeTeam = teamsById.get(match.homeTeamId);
          const awayTeam = teamsById.get(match.awayTeamId);

          if (!homeTeam || !awayTeam || !homeTeam.tags.bigThree || !awayTeam.tags.bigThree) {
            continue;
          }

          if (match.homeTeamId === team.id) {
            homeDerbies += 1;
          }

          if (match.awayTeamId === team.id) {
            awayDerbies += 1;
          }
        }
      }

      if (homeDerbies !== 1 || awayDerbies !== 1) {
        affectedTeams.push(team.id);
      }
    }

    return {
      id: "big_three_derby_balance",
      name: "Big three derby balance",
      passed: affectedTeams.length === 0,
      severity: "hard",
      explanation:
        affectedTeams.length === 0
          ? "Each big-three team has one home and one away big-three derby in the first half."
          : "At least one big-three team does not have one home and one away derby in the first half.",
      affectedWeeks: [],
      affectedTeams,
    };
  }

  function validateDerbyForbiddenWeeks(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];

    for (const week of currentSchedule.weeks) {
      if (!DERBY_FORBIDDEN_FULL_SET.has(week.weekNumber)) {
        continue;
      }

      for (const match of week.matches) {
        const homeTeam = teamsById.get(match.homeTeamId);
        const awayTeam = teamsById.get(match.awayTeamId);

        if (homeTeam?.tags.bigFour && awayTeam?.tags.bigFour) {
          affectedWeeks.push(week.weekNumber);
          affectedTeams.push(match.homeTeamId, match.awayTeamId);
        }
      }
    }

    return {
      id: "derby_forbidden_weeks",
      name: "Derby forbidden weeks",
      passed: affectedWeeks.length === 0,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0
          ? "Big-four derbies avoid the 2026-2027 forbidden derby weeks: 1, 2, 11, 17, 18, 22, 28 and 31."
          : "A big-four derby is placed in one of the forbidden derby weeks.",
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateBigFourWeeks(currentSchedule: FixtureSchedule): ConstraintResult {
    const bigFourTeams = currentSchedule.teams.filter((team) => team.tags.bigFour);
    const targetWeekSet = new Set(BIG_FOUR_TARGET_WEEKS);
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];
    const firstHalf = currentSchedule.weeks.filter((week) => week.weekNumber <= FIRST_HALF_WEEKS);

    if (bigFourTeams.length !== 4) {
      return {
        id: "big_four_weeks",
        name: "Big four target weeks",
        passed: false,
        severity: "hard",
        explanation: `Expected exactly 4 big-four teams, found ${bigFourTeams.length}.`,
        affectedWeeks: [],
        affectedTeams: bigFourTeams.map((team) => team.id),
      };
    }

    const bigFourIds = new Set(bigFourTeams.map((team) => team.id));
    const targetWeekCounts = new Map(BIG_FOUR_TARGET_WEEKS.map((week) => [week, 0]));
    const bigFourMatchTeams: string[] = [];
    let bigFourMatchCount = 0;

    for (const week of firstHalf) {
      for (const match of week.matches) {
        if (!bigFourIds.has(match.homeTeamId) || !bigFourIds.has(match.awayTeamId)) {
          continue;
        }

        bigFourMatchCount += 1;
        bigFourMatchTeams.push(match.homeTeamId, match.awayTeamId);

        if (targetWeekSet.has(week.weekNumber)) {
          targetWeekCounts.set(week.weekNumber, (targetWeekCounts.get(week.weekNumber) ?? 0) + 1);
        } else {
          affectedWeeks.push(week.weekNumber);
        }
      }
    }

    for (const [week, count] of targetWeekCounts) {
      if (count !== 1) {
        affectedWeeks.push(week);
      }
    }

    return {
      id: "big_four_weeks",
      name: "Big four target weeks",
      passed: affectedWeeks.length === 0 && bigFourMatchCount === 6,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0 && bigFourMatchCount === 6
          ? "The six big-four matches are placed one each in weeks 4, 6, 8, 9, 13 and 15."
          : "A big-four match is outside the requested target weeks, or a target week is missing its big-four match.",
      affectedWeeks,
      affectedTeams: affectedWeeks.length === 0 && bigFourMatchCount === 6 ? [] : bigFourMatchTeams,
    };
  }

  function validateEuropeanRestriction(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];

    for (const week of currentSchedule.weeks) {
      if (!EUROPEAN_RESTRICTED_FULL_SET.has(week.weekNumber)) {
        continue;
      }

      for (const match of week.matches) {
        const homeTeam = teamsById.get(match.homeTeamId);
        const awayTeam = teamsById.get(match.awayTeamId);

        if (homeTeam && awayTeam && isEuropeanRestrictedPair(homeTeam, awayTeam)) {
          affectedWeeks.push(week.weekNumber);
          affectedTeams.push(homeTeam.id, awayTeam.id);
        }
      }
    }

    return {
      id: "european_restriction",
      name: "European restricted weeks",
      passed: affectedWeeks.length === 0,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0
          ? "Champions League teams avoid Europa League and Conference League teams in the restricted weeks."
          : "A Champions League team is paired with a Europa League or Conference League team in a restricted week.",
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateIstanbulHomeLimit(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];

    for (const week of currentSchedule.weeks) {
      const homeIstanbulTeams = week.matches
        .map((match) => teamsById.get(match.homeTeamId))
        .filter((team): team is Team => Boolean(team?.isIstanbulTeam));

      if (homeIstanbulTeams.length > 4) {
        affectedWeeks.push(week.weekNumber);
        affectedTeams.push(...homeIstanbulTeams.map((team) => team.id));
      }
    }

    return {
      id: "istanbul_home_limit",
      name: "İstanbul home limit",
      passed: affectedWeeks.length === 0,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0
          ? "No week has more than four İstanbul teams at home."
          : "At least one week has more than four İstanbul teams at home.",
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateIstanbulCityPresence(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];

    for (const team of currentSchedule.teams.filter((entry) => entry.isIstanbulTeam)) {
      const presence = currentSchedule.weeks.map((week) => {
        const match = week.matches.find((entry) => entry.homeTeamId === team.id || entry.awayTeamId === team.id);

        if (!match) {
          return false;
        }

        if (match.homeTeamId === team.id) {
          return true;
        }

        return teamsById.get(match.homeTeamId)?.isIstanbulTeam ?? false;
      });

      let streakStart = 0;
      let streakLength = 0;

      presence.forEach((inIstanbul, index) => {
        if (inIstanbul) {
          if (streakLength === 0) {
            streakStart = index;
          }

          streakLength += 1;
        } else {
          if (streakLength > 6) {
            affectedTeams.push(team.id);
            for (let week = streakStart + 1; week <= streakStart + streakLength; week += 1) {
              affectedWeeks.push(week);
            }
          }

          streakLength = 0;
        }
      });

      if (streakLength > 6) {
        affectedTeams.push(team.id);
        for (let week = streakStart + 1; week <= streakStart + streakLength; week += 1) {
          affectedWeeks.push(week);
        }
      }
    }

    return {
      id: "istanbul_city_presence",
      name: "İstanbul consecutive city presence",
      passed: affectedWeeks.length === 0,
      severity: "soft",
      explanation:
        affectedWeeks.length === 0
          ? "No İstanbul team exceeds six consecutive matches played in İstanbul."
          : "At least one İstanbul team exceeds six consecutive matches played in İstanbul.",
      affectedWeeks,
      affectedTeams,
    };
  }

  function validateSameStadium(currentSchedule: FixtureSchedule): ConstraintResult {
    const affectedWeeks: number[] = [];
    const affectedTeams: string[] = [];
    const groups = new Map<string, Team[]>();

    for (const team of currentSchedule.teams) {
      if (!team.tags.sameStadiumGroup) {
        continue;
      }

      const group = groups.get(team.tags.sameStadiumGroup) ?? [];
      group.push(team);
      groups.set(team.tags.sameStadiumGroup, group);
    }

    for (const week of currentSchedule.weeks) {
      for (const groupTeams of groups.values()) {
        const homeTeamsInGroup = groupTeams.filter((team) =>
          week.matches.some((match) => match.homeTeamId === team.id),
        );

        if (homeTeamsInGroup.length > 1) {
          affectedWeeks.push(week.weekNumber);
          affectedTeams.push(...homeTeamsInGroup.map((team) => team.id));
        }
      }
    }

    return {
      id: "same_stadium",
      name: "Same stadium separation",
      passed: affectedWeeks.length === 0,
      severity: "hard",
      explanation:
        affectedWeeks.length === 0
          ? "Teams marked as sharing a stadium are not both home in the same week."
          : "At least one same-stadium group has multiple home teams in the same week.",
      affectedWeeks,
      affectedTeams,
    };
  }
}

function buildHomeAwaySequence(schedule: FixtureSchedule, teamId: string): string[] {
  return schedule.weeks
    .slice()
    .sort((weekA, weekB) => weekA.weekNumber - weekB.weekNumber)
    .map((week) => {
      const match = week.matches.find((entry) => entry.homeTeamId === teamId || entry.awayTeamId === teamId);

      if (!match) {
        return "?";
      }

      return match.homeTeamId === teamId ? "H" : "A";
    });
}

function countSequenceBreaks(sequence: string[]): { home: number; away: number } {
  let home = 0;
  let away = 0;

  for (let index = 1; index < sequence.length; index += 1) {
    if (sequence[index] !== sequence[index - 1]) {
      continue;
    }

    if (sequence[index] === "H") {
      home += 1;
    } else if (sequence[index] === "A") {
      away += 1;
    }
  }

  return { home, away };
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function scoreSchedule(schedule: FixtureSchedule): ScheduleScore {
  const validationResults =
    schedule.validationResults.length > 0 ? schedule.validationResults : validateSchedule(schedule);
  let hardPenalty = 0;
  let softPenalty = 0;
  let hardFailures = 0;
  let softFailures = 0;

  for (const result of validationResults) {
    if (result.passed) {
      continue;
    }

    const affectedWeight = Math.max(1, result.affectedWeeks.length + result.affectedTeams.length);

    if (result.severity === "hard") {
      hardFailures += 1;
      hardPenalty += 100_000 + affectedWeight * 1_000;
    } else {
      softFailures += 1;
      softPenalty += 1_000 + affectedWeight * 50;
    }
  }

  const teamsById = getTeamMap(schedule.teams);
  const weeksWithFourIstanbulHomeTeams = schedule.weeks.filter((week) => {
    const homeIstanbulCount = week.matches.filter((match) => teamsById.get(match.homeTeamId)?.isIstanbulTeam).length;
    return homeIstanbulCount === 4;
  }).length;

  softPenalty += weeksWithFourIstanbulHomeTeams * 25;

  return {
    hardPenalty,
    softPenalty,
    totalPenalty: hardPenalty + softPenalty,
    hardFailures,
    softFailures,
  };
}

export function exportFixtureAsJson(schedule: FixtureSchedule): string {
  return JSON.stringify(schedule, null, 2);
}

export function exportValidationAsJson(schedule: FixtureSchedule): string {
  return JSON.stringify(schedule.validationResults, null, 2);
}

export function exportFixtureAsCsv(schedule: FixtureSchedule): string {
  const teamsById = getTeamMap(schedule.teams);
  const rows = [["Week", "Home Team", "Away Team", "Home City", "Away City"]];

  for (const week of schedule.weeks) {
    for (const match of week.matches) {
      const homeTeam = teamsById.get(match.homeTeamId);
      const awayTeam = teamsById.get(match.awayTeamId);
      rows.push([
        String(week.weekNumber),
        homeTeam?.name ?? match.homeTeamId,
        awayTeam?.name ?? match.awayTeamId,
        homeTeam?.city ?? "",
        awayTeam?.city ?? "",
      ]);
    }
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

export const fixtureEngineConstants = {
  firstHalfWeeks: FIRST_HALF_WEEKS,
  totalWeeks: TOTAL_WEEKS,
  bigFourTargetWeeks: BIG_FOUR_TARGET_WEEKS,
  derbyForbiddenWeeks: DERBY_FORBIDDEN_FULL_WEEKS,
  europeanRestrictedFullWeeks: EUROPEAN_RESTRICTED_FULL_WEEKS,
  europeanRestrictedFirstHalf: EUROPEAN_RESTRICTED_FULL_WEEKS.filter((week) => week <= FIRST_HALF_WEEKS),
  europeanRestrictedSecondHalf: EUROPEAN_RESTRICTED_FULL_WEEKS.filter((week) => week > FIRST_HALF_WEEKS),
};
