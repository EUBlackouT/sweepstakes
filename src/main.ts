import './style.css';
import { getSupabaseClient, SUPABASE_ROOM_ID } from './supabase';

type SeedKey = 'seed1' | 'seed2' | 'seed3' | 'seed4';
type MatchStatus = 'scheduled' | 'live' | 'finished';
type MatchSource = 'manual' | 'api';

interface DrawnTeams {
  seed1: string;
  seed2: string;
  seed3?: string;
  seed4?: string;
}

interface Participant {
  id: string;
  name: string;
  joinedAt: string;
  teams?: DrawnTeams;
}

interface Match {
  id: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  source: MatchSource;
  round: number | null;
  apiEventId?: string;
  homeBadge?: string | null;
  awayBadge?: string | null;
}

interface AppState {
  participants: Participant[];
  matches: Match[];
  locked: boolean;
  drawCompletedAt: string | null;
}

/** Shared cloud payload — participants/draw only. Matches are never shared via cloud. */
interface CloudAppState {
  participants: Participant[];
  locked: boolean;
  drawCompletedAt: string | null;
}

interface SyncState {
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

interface PersonalMatch extends Match {
  personalTeam: string;
  opponent: string;
}

interface AppStateRow {
  room_id: string;
  app_state: AppState;
  updated_at: string;
}

interface GroupDefinition {
  name: string;
  teams: string[];
}

interface GroupTeamStanding {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

const STORAGE_KEY = 'world-cup-sweepstake-v2';
const SELECTED_PROFILE_KEY = 'sweepstake-selected-profile';
const LEGACY_ADMIN_SESSION_KEY = 'sweepstake-admin-unlocked';
const WORLD_CUP_LEAGUE_ID = '4429';
const WORLD_CUP_TARGET_SEASON = '2026';
const GROUP_STAGE_ROUNDS = [1, 2, 3];
// TheSportsDB uses knockout bracket size as round number (32 = Round of 32, etc.).
const KNOCKOUT_ROUNDS = [32, 16, 8, 4, 2];
const WORLD_CUP_FETCH_ROUNDS = [...GROUP_STAGE_ROUNDS, ...KNOCKOUT_ROUNDS];
const SYNC_INTERVAL_MS = 30_000;
const CLOUD_SYNC_INTERVAL_MS = 4_000;
const SIDE_LEFT_IMAGE = (import.meta.env.VITE_SIDE_LEFT_IMAGE as string | undefined) ?? '/side-left.jpg';
const SIDE_RIGHT_IMAGE =
  (import.meta.env.VITE_SIDE_RIGHT_IMAGE as string | undefined) ?? '/side-right.jpg';
const POINTS = {
  win: 3,
  draw: 1,
  cleanSheet: 1,
  goalBonus: 1,
};

const DEFAULT_SEEDS: Record<SeedKey, string[]> = {
  seed1: [
    'Argentina',
    'Belgium',
    'Brazil',
    'Colombia',
    'Croatia',
    'England',
    'France',
    'Germany',
    'Mexico',
    'Morocco',
    'Netherlands',
    'Portugal',
    'Senegal',
    'Spain',
    'United States',
    'Uruguay',
  ],
  seed2: [
    'Algeria',
    'Australia',
    'Austria',
    'Canada',
    'Ecuador',
    'Egypt',
    'Iran',
    'Ivory Coast',
    'Japan',
    'Norway',
    'Panama',
    'Paraguay',
    'South Korea',
    'Sweden',
    'Switzerland',
    'Turkey',
  ],
  seed3: [
    'Bosnia and Herzegovina',
    'Cape Verde',
    'Curacao',
    'Czech Republic',
    'DR Congo',
    'Ghana',
    'Haiti',
    'Iraq',
    'Jordan',
    'New Zealand',
    'Qatar',
    'Saudi Arabia',
    'Scotland',
    'South Africa',
    'Tunisia',
    'Uzbekistan',
  ],
  seed4: [],
};

const CHEEZ_SEEDS: Record<SeedKey, string[]> = {
  seed1: [
    'France',
    'Spain',
    'Argentina',
    'England',
    'Portugal',
    'Brazil',
    'Netherlands',
    'Morocco',
    'Belgium',
    'Germany',
    'Croatia',
    'Colombia',
    'Senegal',
    'Mexico',
    'United States',
    'Uruguay',
    'Japan',
    'Switzerland',
    'Iran',
    'Turkey',
    'Ecuador',
    'Austria',
    'South Korea',
    'Australia',
  ],
  seed2: [
    'Algeria',
    'Egypt',
    'Canada',
    'Norway',
    'Panama',
    'Ivory Coast',
    'Sweden',
    'Paraguay',
    'Czech Republic',
    'Scotland',
    'Tunisia',
    'DR Congo',
    'Uzbekistan',
    'Qatar',
    'Iraq',
    'South Africa',
    'Saudi Arabia',
    'Jordan',
    'Bosnia and Herzegovina',
    'Cape Verde',
    'Ghana',
    'Curacao',
    'Haiti',
    'New Zealand',
  ],
  seed3: [],
  seed4: [],
};

const ROOM_SEED_OVERRIDES: Record<string, Record<SeedKey, string[]>> = {
  cheez: CHEEZ_SEEDS,
  'cheesy-world-cup': CHEEZ_SEEDS,
  angrybunch: {
    seed1: [
      'Canada',
      'Mexico',
      'United States',
      'Spain',
      'Argentina',
      'France',
      'England',
      'Brazil',
      'Portugal',
      'Netherlands',
      'Belgium',
      'Germany',
    ],
    seed2: [
      'Croatia',
      'Morocco',
      'Colombia',
      'Uruguay',
      'Switzerland',
      'Japan',
      'Senegal',
      'IR Iran',
      'Korea Republic',
      'Ecuador',
      'Austria',
      'Australia',
    ],
    seed3: [
      'Norway',
      'Panama',
      'Egypt',
      'Algeria',
      'Scotland',
      'Paraguay',
      'Tunisia',
      'Ivory Coast',
      'Uzbekistan',
      'Qatar',
      'Saudi Arabia',
      'South Africa',
    ],
    seed4: [
      'Jordan',
      'Cape Verde',
      'Ghana',
      'Curacao',
      'Haiti',
      'New Zealand',
      'Sweden',
      'Bosnia and Herzegovina',
      'Iraq',
      'DR Congo',
      'Turkey',
      'Czech Republic',
    ],
  },
};

function getSeedsForRoom(roomId: string): Record<SeedKey, string[]> {
  const roomKey = roomId.trim().toLowerCase();
  const override = ROOM_SEED_OVERRIDES[roomKey];
  return override ?? DEFAULT_SEEDS;
}

const seeds = getSeedsForRoom(SUPABASE_ROOM_ID);
const ALL_SEED_KEYS: SeedKey[] = ['seed1', 'seed2', 'seed3', 'seed4'];
const ACTIVE_SEED_KEYS: SeedKey[] = ALL_SEED_KEYS.filter((seedKey) => seeds[seedKey].length > 0);
const allTeams = ACTIVE_SEED_KEYS.flatMap((seedKey) => seeds[seedKey]);
const normalizedTeamSet = new Set(allTeams.map(normalizeTeamName));
const MAX_DRAW_PARTICIPANTS = Math.min(...ACTIVE_SEED_KEYS.map((seedKey) => seeds[seedKey].length));
const IS_CHEEZ_ROOM = ['cheez', 'cheesy-world-cup'].includes(SUPABASE_ROOM_ID.trim().toLowerCase());
const GROUPS_DROPDOWN_ROOMS = new Set(['angrybunch', 'cheez']);
const SHOW_GROUPS_DROPDOWN = GROUPS_DROPDOWN_ROOMS.has(SUPABASE_ROOM_ID.trim().toLowerCase());
const WORLD_CUP_GROUPS: GroupDefinition[] = [
  { name: 'Group A', teams: ['Mexico', 'South Africa', 'Korea Republic', 'Czech Republic'] },
  { name: 'Group B', teams: ['Canada', 'Bosnia and Herzegovina', 'Qatar', 'Switzerland'] },
  { name: 'Group C', teams: ['Brazil', 'Morocco', 'Haiti', 'Scotland'] },
  { name: 'Group D', teams: ['United States', 'Paraguay', 'Australia', 'Turkey'] },
  { name: 'Group E', teams: ['Germany', 'Curacao', 'Ivory Coast', 'Ecuador'] },
  { name: 'Group F', teams: ['Netherlands', 'Japan', 'Sweden', 'Tunisia'] },
  { name: 'Group G', teams: ['Belgium', 'Egypt', 'IR Iran', 'New Zealand'] },
  { name: 'Group H', teams: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'] },
  { name: 'Group I', teams: ['France', 'Senegal', 'Iraq', 'Norway'] },
  { name: 'Group J', teams: ['Argentina', 'Algeria', 'Austria', 'Jordan'] },
  { name: 'Group K', teams: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'] },
  { name: 'Group L', teams: ['England', 'Croatia', 'Ghana', 'Panama'] },
];
const TEAM_FLAG_CODES: Record<string, string> = {
  argentina: 'AR',
  belgium: 'BE',
  brazil: 'BR',
  colombia: 'CO',
  croatia: 'HR',
  england: 'GB',
  france: 'FR',
  germany: 'DE',
  mexico: 'MX',
  morocco: 'MA',
  netherlands: 'NL',
  portugal: 'PT',
  senegal: 'SN',
  spain: 'ES',
  'united states': 'US',
  uruguay: 'UY',
  algeria: 'DZ',
  australia: 'AU',
  austria: 'AT',
  canada: 'CA',
  ecuador: 'EC',
  egypt: 'EG',
  iran: 'IR',
  'ir iran': 'IR',
  'ivory coast': 'CI',
  japan: 'JP',
  'korea republic': 'KR',
  norway: 'NO',
  panama: 'PA',
  paraguay: 'PY',
  'south korea': 'KR',
  sweden: 'SE',
  switzerland: 'CH',
  turkey: 'TR',
  'bosnia and herzegovina': 'BA',
  'cape verde': 'CV',
  curacao: 'CW',
  'czech republic': 'CZ',
  'dr congo': 'CD',
  ghana: 'GH',
  haiti: 'HT',
  iraq: 'IQ',
  jordan: 'JO',
  'new zealand': 'NZ',
  qatar: 'QA',
  'saudi arabia': 'SA',
  scotland: 'GB',
  'south africa': 'ZA',
  tunisia: 'TN',
  uzbekistan: 'UZ',
};
const appElMaybe = document.querySelector<HTMLDivElement>('#app');

if (!appElMaybe) {
  throw new Error('App root not found.');
}
const appEl = appElMaybe;

setSideBannerImages();

let state = loadState();
let syncState: SyncState = {
  loading: false,
  error: null,
  lastSyncedAt: null,
};
// Never trust prior browser unlock state; require fresh server-side PIN verification.
sessionStorage.removeItem(LEGACY_ADMIN_SESSION_KEY);
let adminUnlocked = false;
let joinDraft = { name: '' };
let liveFailureCount = 0;
let liveCooldownUntil = 0;
let selectedParticipantId = localStorage.getItem(SELECTED_PROFILE_KEY);
let groupsSearchQuery = '';
const supabase = getSupabaseClient();
let cloudSyncError: string | null = null;
let cloudSyncStatus: 'disabled' | 'syncing' | 'online' = supabase ? 'syncing' : 'disabled';
let ignoreNextCloudPush = false;
let cloudSubscriptionStarted = false;
let lastFetchedApiMatches: Match[] = [];

render();
void initializeApp();
window.setInterval(() => {
  if (!document.hidden) {
    void syncApiMatches();
  }
}, SYNC_INTERVAL_MS);
window.setInterval(() => {
  void pullCloudState();
}, CLOUD_SYNC_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void pullCloudState().then(() => syncApiMatches());
  }
});
window.addEventListener('online', () => {
  void pullCloudState().then(() => syncApiMatches());
});

function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      participants: [],
      matches: [],
      locked: false,
      drawCompletedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(raw) as AppState;
    return {
      participants: parsed.participants ?? [],
      matches: parsed.matches ?? [],
      locked: Boolean(parsed.locked),
      drawCompletedAt: parsed.drawCompletedAt ?? null,
    };
  } catch {
    return {
      participants: [],
      matches: [],
      locked: false,
      drawCompletedAt: null,
    };
  }
}

function setSideBannerImages(): void {
  document.documentElement.style.setProperty('--side-left-image', `url("${SIDE_LEFT_IMAGE}")`);
  document.documentElement.style.setProperty('--side-right-image', `url("${SIDE_RIGHT_IMAGE}")`);
}

function saveAndRender(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  if (!ignoreNextCloudPush) {
    void pushCloudState();
  }
}

async function initializeApp(): Promise<void> {
  // Participants/draw from cloud first, then matches from the live API.
  // Never race these — racing caused every browser to show different points.
  await bootstrapCloudState();
  await syncApiMatches(true);
  // Clear any stale match blobs previously written into Supabase so all clients converge.
  if (cloudSyncStatus === 'online') {
    await pushCloudState(true);
  }
}

function toCloudAppState(source: AppState = state): CloudAppState {
  return {
    participants: source.participants,
    locked: source.locked,
    drawCompletedAt: source.drawCompletedAt,
  };
}

function applyCloudParticipants(cloud: CloudAppState): void {
  state = {
    ...state,
    participants: cloud.participants,
    locked: cloud.locked,
    drawCompletedAt: cloud.drawCompletedAt,
    // Matches stay local/API-owned — never replace from cloud.
    matches: getAuthoritativeMatches(state.matches),
  };
}

function getAuthoritativeMatches(fallback: Match[] = state.matches): Match[] {
  const manualMatches = fallback.filter((match) => match.source === 'manual');
  if (lastFetchedApiMatches.length > 0) {
    return [...manualMatches, ...lastFetchedApiMatches].sort(
      (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime(),
    );
  }
  // Until the first successful API sync, keep whatever API matches we already have locally.
  return [
    ...manualMatches,
    ...fallback.filter((match) => match.source === 'api').map(normalizeMatchRecord),
  ].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
}

async function bootstrapCloudState(): Promise<void> {
  if (!supabase) {
    cloudSyncStatus = 'disabled';
    cloudSyncError = 'Supabase not configured';
    render();
    return;
  }

  await pullCloudState(true);
  startCloudSubscription();
}

async function pullCloudState(initial = false): Promise<void> {
  if (!supabase) {
    return;
  }
  if (cloudSyncStatus === 'syncing' && !initial) {
    return;
  }

  cloudSyncStatus = 'syncing';
  if (initial) {
    render();
  }

  try {
    const { data, error } = await supabase
      .from('sweepstake_state')
      .select('room_id, app_state, updated_at')
      .eq('room_id', SUPABASE_ROOM_ID)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      await pushCloudState(true);
      cloudSyncStatus = 'online';
      cloudSyncError = null;
      render();
      return;
    }

    const cloud = sanitizeCloudAppState((data as AppStateRow).app_state);
    const before = JSON.stringify(toCloudAppState());
    const after = JSON.stringify(cloud);
    if (before !== after) {
      ignoreNextCloudPush = true;
      applyCloudParticipants(cloud);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      ignoreNextCloudPush = false;
    } else {
      // Still refresh matches from the latest API cache so points stay consistent.
      const nextMatches = getAuthoritativeMatches(state.matches);
      if (JSON.stringify(nextMatches) !== JSON.stringify(state.matches)) {
        state.matches = nextMatches;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
      }
    }

    cloudSyncStatus = 'online';
    cloudSyncError = null;
  } catch (error) {
    cloudSyncStatus = 'disabled';
    cloudSyncError = formatCloudError(error);
    render();
  }
}

async function pushCloudState(isBootstrap = false): Promise<void> {
  if (!supabase) {
    return;
  }
  if (ignoreNextCloudPush) {
    return;
  }
  try {
    // Never write match/score data to cloud — that caused every client to diverge.
    const { error } = await supabase.from('sweepstake_state').upsert(
      {
        room_id: SUPABASE_ROOM_ID,
        app_state: {
          ...toCloudAppState(),
          matches: [],
        },
      },
      { onConflict: 'room_id' },
    );
    if (error) {
      throw error;
    }
    cloudSyncStatus = 'online';
    cloudSyncError = null;
    if (!isBootstrap) {
      render();
    }
  } catch (error) {
    cloudSyncStatus = 'disabled';
    cloudSyncError = formatCloudError(error);
    render();
  }
}

function startCloudSubscription(): void {
  if (!supabase || cloudSubscriptionStarted) {
    return;
  }
  cloudSubscriptionStarted = true;
  supabase
    .channel(`sweepstake-state-${SUPABASE_ROOM_ID}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sweepstake_state',
        filter: `room_id=eq.${SUPABASE_ROOM_ID}`,
      },
      (payload) => {
        const row = (payload.new as Partial<AppStateRow>) ?? null;
        if (!row?.app_state) {
          return;
        }
        const cloud = sanitizeCloudAppState(row.app_state);
        if (JSON.stringify(cloud) === JSON.stringify(toCloudAppState())) {
          return;
        }
        ignoreNextCloudPush = true;
        applyCloudParticipants(cloud);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
        ignoreNextCloudPush = false;
      },
    )
    .subscribe();
}

function sanitizeCloudAppState(raw: AppState | CloudAppState | null | undefined): CloudAppState {
  return {
    participants: raw?.participants ?? [],
    locked: Boolean(raw?.locked),
    drawCompletedAt: raw?.drawCompletedAt ?? null,
  };
}

function formatCloudError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    const message =
      'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
    if (code === '42P01') {
      return 'Supabase table missing: run supabase/schema.sql';
    }
    if (code === '42501') {
      return 'Supabase permissions denied: check RLS policies';
    }
    if (message) {
      return message;
    }
  }
  return 'Cloud sync failed';
}

function render(): void {
  const leaderboard = buildLeaderboard();
  const viewerTimeZone = getViewerTimezone();
  const participantTableColspan = 2 + ACTIVE_SEED_KEYS.length;
  const seedHeaders = ACTIVE_SEED_KEYS.map((_, index) => `<th>Seed ${index + 1}</th>`).join('');
  const hasDrawResults = state.locked && state.participants.some((p) => Boolean(p.teams));
  if (selectedParticipantId && !state.participants.some((p) => p.id === selectedParticipantId)) {
    selectedParticipantId = null;
    localStorage.removeItem(SELECTED_PROFILE_KEY);
  }
  const selectedParticipant =
    state.participants.find((p) => p.id === selectedParticipantId) ?? null;
  const personalMatches = selectedParticipant?.teams
    ? getPersonalMatchesFromMatches(state.matches, selectedParticipant.teams)
    : [];
  const liveMatches = getLiveMatches();
  const teamOwners = getTeamOwnersMap();
  const liveMatchesWithOwners = liveMatches.filter((match) =>
    isSweepstakeMatch(match, teamOwners),
  );
  const liveClashCount = liveMatches.filter((match) => {
    const homeOwners = getOwnersForTeam(match.homeTeam, teamOwners);
    const awayOwners = getOwnersForTeam(match.awayTeam, teamOwners);
    return homeOwners.length > 0 && awayOwners.length > 0;
  }).length;
  const upcomingSweepstakeMatches = state.matches
    .filter(
      (match) =>
        match.status === 'scheduled' &&
        kickoffToDate(match.kickoff).getTime() >= Date.now() &&
        isSweepstakeMatch(match, teamOwners),
    )
    .sort((a, b) => kickoffToDate(a.kickoff).getTime() - kickoffToDate(b.kickoff).getTime())
    .slice(0, 16);
  const previousMatchLimit = getPreviousMatchLimit(upcomingSweepstakeMatches.length);
  const previousSweepstakeMatches = state.matches
    .filter(
      (match) => isResolvedFinishedMatch(match) && isSweepstakeMatch(match, teamOwners),
    )
    .sort((a, b) => kickoffToDate(b.kickoff).getTime() - kickoffToDate(a.kickoff).getTime())
    .slice(0, previousMatchLimit);
  const groupStandings = buildWorldCupGroupStandings(state.matches);

  appEl.innerHTML = `
    <div class="page">
      <main class="grid">
        <section class="card full admin-panel">
          <div class="card-head">
            <h2>Admin Controls</h2>
            <span class="badge ${adminUnlocked ? 'good' : 'bad'}">${adminUnlocked ? 'Unlocked' : 'Locked'}</span>
          </div>
          <div class="actions">
            ${
              adminUnlocked
                ? '<button id="admin-lock" class="ghost small">Hide Admin Buttons</button>'
                : '<button id="admin-unlock" class="ghost small">Unlock with PIN</button>'
            }
          </div>
        </section>
        ${
          hasDrawResults
            ? ''
            : `
              <section class="card full setup-panel">
                <div class="card-head">
                  <h2>Setup Sweepstake</h2>
                  <span class="badge ${state.locked ? 'bad' : 'good'}">${state.locked ? 'Entries Closed' : `${state.participants.length} players`}</span>
                </div>
                <div class="actions">
                  <form id="join-form" class="stack inline-form">
                    <input name="name" required maxlength="28" placeholder="Name" value="${escapeHtml(joinDraft.name)}" ${state.locked ? 'disabled' : ''} />
                    <button type="submit" ${state.locked ? 'disabled' : ''}>Join Contest</button>
                  </form>
                  ${
                    adminUnlocked
                      ? `
                        <button id="run-draw" ${state.participants.length < 1 || state.participants.length > MAX_DRAW_PARTICIPANTS ? 'disabled' : ''}>Roll Teams (RNG)</button>
                        <button id="lock-draw" class="ghost" ${state.participants.length < 1 || state.participants.length > MAX_DRAW_PARTICIPANTS ? 'disabled' : ''}>Lock Final Draw</button>
                        <button id="reset-all" class="danger">${IS_CHEEZ_ROOM ? 'Reset Draw' : 'Reset'}</button>
                      `
                      : '<span class="hint">Admin draw buttons are hidden until PIN unlock.</span>'
                  }
                </div>
                <p class="hint">Once draw is locked, the interface switches to clean viewer mode with only live sections. This room supports up to ${MAX_DRAW_PARTICIPANTS} players.</p>
              </section>
            `
        }

        <section class="card full participants-section">
          ${
            hasDrawResults
              ? `
                <details class="participants-dropdown">
                  <summary>
                    <span>Contestants and Assigned Teams</span>
                    <span class="badge">${state.participants.length} players</span>
                  </summary>
                  <div class="participants-dropdown-content">
                    ${
                      adminUnlocked
                        ? '<div class="actions"><button id="clear-draw" class="ghost small">Clear Current Draw</button></div>'
                        : ''
                    }
                    <div class="table-wrap">
                      <table class="participants-table">
                        <thead>
                          <tr>
                            <th>Player</th>
                            ${seedHeaders}
                            <th>${adminUnlocked ? '' : ''}</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${
                            state.participants.length === 0
                              ? `<tr><td colspan="${participantTableColspan}" class="empty">No players joined yet.</td></tr>`
                              : state.participants
                                  .map(
                                    (p) => `
                                      <tr>
                                        <td>${escapeHtml(p.name)}</td>
                                        ${ACTIVE_SEED_KEYS.map(
                                          (seedKey) => `<td>${escapeHtml(p.teams?.[seedKey] ?? '-')}</td>`,
                                        ).join('')}
                                        <td>${adminUnlocked ? `<button class="ghost small remove-player" data-id="${p.id}" ${state.locked ? 'disabled' : ''}>Remove</button>` : ''}</td>
                                      </tr>
                                    `,
                                  )
                                  .join('')
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              `
              : `
                <div class="card-head">
                  <h2>Contestants and Assigned Teams</h2>
                </div>
                <div class="table-wrap">
                  <table class="participants-table">
                    <thead>
                      <tr>
                        <th>Player</th>
                        ${seedHeaders}
                        <th>${adminUnlocked ? '' : ''}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${
                        state.participants.length === 0
                          ? `<tr><td colspan="${participantTableColspan}" class="empty">No players joined yet.</td></tr>`
                          : state.participants
                              .map(
                                (p) => `
                                  <tr>
                                    <td>${escapeHtml(p.name)}</td>
                                    ${ACTIVE_SEED_KEYS.map(
                                      (seedKey) => `<td>${escapeHtml(p.teams?.[seedKey] ?? '-')}</td>`,
                                    ).join('')}
                                    <td>${adminUnlocked ? `<button class="ghost small remove-player" data-id="${p.id}" ${state.locked ? 'disabled' : ''}>Remove</button>` : ''}</td>
                                  </tr>
                                `,
                              )
                              .join('')
                      }
                    </tbody>
                  </table>
                </div>
              `
          }
        </section>

        ${
          SHOW_GROUPS_DROPDOWN
            ? `
              <section class="card full groups-section">
                <details class="groups-dropdown">
                  <summary>
                    <span>World Cup Groups</span>
                    <span class="badge">${WORLD_CUP_GROUPS.length} groups</span>
                  </summary>
                  <div class="groups-toolbar">
                    <label class="groups-search">
                      <span class="sr-only">Search groups</span>
                      <input
                        id="groups-search"
                        type="search"
                        placeholder="Search team or player..."
                        value="${escapeHtml(groupsSearchQuery)}"
                      />
                    </label>
                    <p class="hint groups-sync-note">Standings use World Cup group rules (3 pts win, 1 pt draw) and update automatically from live results.</p>
                  </div>
                  <div class="groups-grid">
                    ${WORLD_CUP_GROUPS.map((group) => {
                      const standings = groupStandings.get(group.name) ?? [];
                      return `
                        <article class="group-card" data-group="${escapeHtml(group.name.toLowerCase())}">
                          <h3>${escapeHtml(group.name)}</h3>
                          <div class="group-standings">
                            <div class="group-standings-head" aria-hidden="true">
                              <span>#</span>
                              <span>Team</span>
                              <span>Pts</span>
                              <span>P</span>
                              <span>F-A</span>
                              <span>Owner</span>
                            </div>
                            <ul class="group-standings-list">
                              ${standings
                                .map((row, index) => {
                                  const rank = index + 1;
                                  const owners = getOwnersForTeam(row.team, teamOwners);
                                  const ownerLabel = owners.length > 0 ? formatOwners(owners) : '-';
                                  return `
                                    <li
                                      class="group-standing-row${rank === 1 && row.points > 0 ? ' group-standing-row--leader' : ''}"
                                      data-team="${escapeHtml(row.team.toLowerCase())}"
                                      data-owner="${escapeHtml(ownerLabel.toLowerCase())}"
                                    >
                                      <span class="group-rank">${rank}</span>
                                      <span class="group-team" title="${escapeHtml(row.team)}">
                                        ${teamFlagIcon(row.team)}
                                        <span>${escapeHtml(row.team)}</span>
                                      </span>
                                      <span class="group-stat group-stat--pts">${row.points}</span>
                                      <span class="group-stat">${row.played}</span>
                                      <span class="group-stat">${row.goalsFor}-${row.goalsAgainst}</span>
                                      <span class="group-owner" title="${escapeHtml(ownerLabel)}">${owners.length > 0 ? `🎯 ${escapeHtml(ownerLabel)}` : '-'}</span>
                                    </li>
                                  `;
                                })
                                .join('')}
                            </ul>
                          </div>
                        </article>
                      `;
                    }).join('')}
                  </div>
                </details>
              </section>
            `
            : ''
        }

        <section class="card full live-section">
          <div class="card-head">
            <h2>Live Matches Right Now</h2>
            <span class="badge">${liveMatches.length} active / ${liveMatchesWithOwners.length} sweepstake</span>
          </div>
          <p class="hint live-sync-note">
            <span class="heartbeat ${syncState.loading ? 'loading' : ''}" aria-hidden="true"></span>
            Auto-updates every 30 seconds. Last sync: ${syncState.lastSyncedAt ? `${formatDateTime(syncState.lastSyncedAt)} (${formatSyncAge(syncState.lastSyncedAt)})` : 'not yet synced'} (${escapeHtml(viewerTimeZone)})
            ${syncState.error ? ` | ${escapeHtml(syncState.error)}` : ''}
            | Shared sync: ${cloudSyncStatus === 'online' ? 'online' : cloudSyncStatus === 'syncing' ? 'syncing' : 'offline'}
            ${cloudSyncError ? ` (${escapeHtml(cloudSyncError)})` : ''}
          </p>
          <div class="actions">
            <button id="refresh-api" class="ghost small">Refresh Live Now</button>
          </div>
          <div class="live-grid">
            ${
              liveMatches.length === 0
                ? '<p class="empty">No matches currently live.</p>'
                : liveMatches
                    .map(
                      (m) => `
                        <article class="live-tile">
                          <div class="teams">
                            <div class="team">
                              ${teamBadge(m.homeBadge, m.homeTeam)}
                              ${teamFlagIcon(m.homeTeam)}
                              <span>${escapeHtml(m.homeTeam)}</span>
                            </div>
                            <strong>${displayScore(m)}</strong>
                            <div class="team">
                              ${teamBadge(m.awayBadge, m.awayTeam)}
                              ${teamFlagIcon(m.awayTeam)}
                              <span>${escapeHtml(m.awayTeam)}</span>
                            </div>
                          </div>
                          ${renderMatchOwnerRow(m, teamOwners)}
                          <div class="meta">
                            <span>${statusChip(m.status)}</span>
                            <span>${formatDateTime(m.kickoff)}</span>
                          </div>
                        </article>
                      `,
                    )
                    .join('')
            }
          </div>
        </section>

        <section class="card full vs-board">
          <div class="card-head">
            <h2>Upcoming Matches</h2>
            <span class="badge">${liveClashCount} live clashes</span>
          </div>
          ${
            upcomingSweepstakeMatches.length === 0 && previousSweepstakeMatches.length === 0
              ? '<p class="empty">No sweepstake fixtures available yet from current World Cup feed.</p>'
              : `
                <div class="vs-board-grid">
                  ${
                    upcomingSweepstakeMatches.length > 0
                      ? `
                        <div class="vs-column">
                          <p class="hint vs-heading">Upcoming matches</p>
                          <div class="vs-list two-col">
                            ${upcomingSweepstakeMatches
                              .map(
                                (match) => renderUpcomingMatchCard(match, teamOwners),
                              )
                              .join('')}
                          </div>
                        </div>
                      `
                      : ''
                  }
                  ${
                    previousSweepstakeMatches.length > 0
                      ? `
                        <div class="vs-column vs-column--previous">
                          <p class="hint vs-heading">Previous matches</p>
                          <div class="vs-list">
                            ${previousSweepstakeMatches
                              .map(
                                (match) => renderPreviousMatchCard(match, teamOwners),
                              )
                              .join('')}
                          </div>
                        </div>
                      `
                      : ''
                  }
                </div>
              `
          }
        </section>

        <section class="card leaderboard-section">
          <div class="card-head">
            <h2>Leaderboard</h2>
            <span class="badge">Auto-calculated</span>
          </div>
          <div class="table-wrap">
            <table class="leaderboard-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Pts</th>
                  <th>W-D-L</th>
                  <th>GF-GA</th>
                </tr>
              </thead>
              <tbody>
                ${
                  leaderboard.length === 0
                    ? '<tr><td colspan="5" class="empty">Leaderboard appears after draw and finished matches.</td></tr>'
                    : leaderboard
                        .map(
                          (row, index) => `
                            <tr>
                              <td>${index + 1}</td>
                              <td>${escapeHtml(row.name)}</td>
                              <td><strong>${row.points}</strong></td>
                              <td>${row.wins}-${row.draws}-${row.losses}</td>
                              <td>${row.goalsFor}-${row.goalsAgainst}</td>
                            </tr>
                          `,
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>
          <p class="hint">Points: Win ${POINTS.win}, Draw ${POINTS.draw}, Clean Sheet ${POINTS.cleanSheet}, Goal Bonus ${POINTS.goalBonus} per goal.</p>
        </section>

        <section class="card schedule-section">
          <div class="card-head">
            <h2>My Team Schedule</h2>
          </div>
          <label>
            Select profile
            <select id="participant-picker">
              <option value="">Choose contestant...</option>
              ${[...state.participants]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map(
                  (p) =>
                    `<option value="${p.id}" ${p.id === selectedParticipantId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`,
                )
                .join('')}
            </select>
          </label>
          ${
            selectedParticipant?.teams
              ? `
                <div class="owned-teams">
                  ${getAssignedTeams(selectedParticipant.teams)
                    .map(
                      (team) =>
                        `<span class="team-pill">${teamFlagIcon(team)} ${escapeHtml(team)}</span>`,
                    )
                    .join('')}
                </div>
              `
              : `<p class="hint">After draw lock, this profile will show all ${ACTIVE_SEED_KEYS.length} assigned teams here.</p>`
          }
          <div class="table-wrap schedule-wrap">
            <table class="schedule-table">
              <thead>
                <tr>
                  <th>Kickoff</th>
                  <th>Fixture</th>
                  <th>Your Team</th>
                  <th>Opponent</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${
                  !selectedParticipant
                    ? '<tr><td colspan="5" class="empty">Select a player to view schedule.</td></tr>'
                    : personalMatches.length === 0
                      ? '<tr><td colspan="5" class="empty">No World Cup fixtures published yet for this contestant teams.</td></tr>'
                      : personalMatches
                          .map(
                            (m) => `
                              <tr>
                                <td>
                                  <button
                                    class="kickoff-button"
                                    data-kickoff="${escapeHtml(m.kickoff)}"
                                    title="${escapeHtml(formatDateTime(m.kickoff))}"
                                  >
                                    ${formatDateOnly(m.kickoff)}
                                  </button>
                                </td>
                                <td title="${escapeHtml(`${m.homeTeam} vs ${m.awayTeam}`)}"><span class="cell-inline">${teamFlagIcon(m.homeTeam)} ${escapeHtml(m.homeTeam)} vs ${teamFlagIcon(m.awayTeam)} ${escapeHtml(m.awayTeam)}</span></td>
                                <td title="${escapeHtml(m.personalTeam)}"><span class="cell-inline">${teamFlagIcon(m.personalTeam)} ${escapeHtml(m.personalTeam)}</span></td>
                                <td title="${escapeHtml(m.opponent)}"><span class="cell-inline">${teamFlagIcon(m.opponent)} ${escapeHtml(m.opponent)}</span></td>
                                <td>${statusChip(m.status)}</td>
                              </tr>
                            `,
                          )
                          .join('')
                }
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  `;

  document.querySelector<HTMLButtonElement>('#admin-unlock')?.addEventListener('click', unlockAdminControls);
  document.querySelector<HTMLButtonElement>('#admin-lock')?.addEventListener('click', lockAdminControls);
  document.querySelector<HTMLFormElement>('#join-form')?.addEventListener('submit', onJoinSubmit);
  document.querySelector<HTMLButtonElement>('#run-draw')?.addEventListener('click', runDraw);
  document.querySelector<HTMLButtonElement>('#lock-draw')?.addEventListener('click', lockFinalDraw);
  document.querySelector<HTMLButtonElement>('#clear-draw')?.addEventListener('click', clearDrawOnly);
  document.querySelector<HTMLButtonElement>('#reset-all')?.addEventListener('click', resetAll);
  document.querySelector<HTMLButtonElement>('#refresh-api')?.addEventListener('click', () => {
    void syncApiMatches(true);
  });

  document.querySelectorAll<HTMLButtonElement>('.remove-player').forEach((button) => {
    button.addEventListener('click', () => removePlayer(button.dataset.id ?? ''));
  });
  document.querySelectorAll<HTMLButtonElement>('.kickoff-button').forEach((button) => {
    button.addEventListener('click', () => {
      const kickoffIso = button.dataset.kickoff ?? '';
      window.alert(`Kickoff local time: ${formatDateTime(kickoffIso)}\nSource UTC: ${formatUtcDateTime(kickoffIso)}`);
    });
  });

  document
    .querySelector<HTMLSelectElement>('#participant-picker')
    ?.addEventListener('change', (event) => {
      const select = event.currentTarget as HTMLSelectElement;
      selectedParticipantId = select.value || null;
      if (selectedParticipantId) {
        localStorage.setItem(SELECTED_PROFILE_KEY, selectedParticipantId);
      } else {
        localStorage.removeItem(SELECTED_PROFILE_KEY);
      }
      render();
    });
  document.querySelector<HTMLInputElement>('#groups-search')?.addEventListener('input', (event) => {
    groupsSearchQuery = (event.currentTarget as HTMLInputElement).value;
    applyGroupsSearchFilter();
  });
  applyGroupsSearchFilter();
  const nameInput = document.querySelector<HTMLInputElement>('input[name="name"]');
  nameInput?.addEventListener('input', () => {
    joinDraft.name = nameInput.value;
  });

}

function onJoinSubmit(event: SubmitEvent): void {
  event.preventDefault();
  if (state.locked) {
    return;
  }
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  if (!name) {
    return;
  }
  const duplicate = state.participants.some(
    (p) => p.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    window.alert('This name is already registered.');
    return;
  }
  state.participants.push({
    id: crypto.randomUUID(),
    name,
    joinedAt: new Date().toISOString(),
  });
  joinDraft = { name: '' };
  form.reset();
  saveAndRender();
}

function runDraw(): void {
  if (!requireAdminAccess('roll teams')) {
    return;
  }
  if (state.participants.length < 1) {
    return;
  }
  if (state.participants.length > MAX_DRAW_PARTICIPANTS) {
    window.alert(`This room supports up to ${MAX_DRAW_PARTICIPANTS} players for the current pots.`);
    return;
  }
  if (!performConstrainedDraw(false)) {
    return;
  }
  state.locked = false;
  state.drawCompletedAt = null;
  if (!selectedParticipantId && state.participants[0]) {
    selectedParticipantId = state.participants[0].id;
    localStorage.setItem(SELECTED_PROFILE_KEY, selectedParticipantId);
  }
  saveAndRender();
}

function lockFinalDraw(): void {
  if (!requireAdminAccess('lock final draw')) {
    return;
  }
  if (state.participants.length < 1) {
    return;
  }
  if (state.participants.length > MAX_DRAW_PARTICIPANTS) {
    window.alert(`This room supports up to ${MAX_DRAW_PARTICIPANTS} players for the current pots.`);
    return;
  }
  const existingDraw = state.participants.every((p) => Boolean(p.teams));
  if (!existingDraw) {
    const lockWithoutFullDraw = window.confirm(
      'Some players do not have assigned teams yet. Lock anyway and close entries?',
    );
    if (!lockWithoutFullDraw) {
      return;
    }
  }
  state.locked = true;
  state.drawCompletedAt = new Date().toISOString();
  if (!selectedParticipantId && state.participants[0]) {
    selectedParticipantId = state.participants[0].id;
    localStorage.setItem(SELECTED_PROFILE_KEY, selectedParticipantId);
  }
  saveAndRender();
}

function performConstrainedDraw(strictOnly: boolean): boolean {
  if (IS_CHEEZ_ROOM && ACTIVE_SEED_KEYS.length === 2) {
    const cheezDraw = generateCheezGroupSafeDraw(state.participants.length);
    if (!cheezDraw) {
      window.alert(
        'Could not produce a valid Cheesy draw without same-group pairs. Please try draw again.',
      );
      return false;
    }
    state.participants = state.participants.map((participant, index) => ({
      ...participant,
      teams: cheezDraw[index],
    }));
    return true;
  }

  const groupMap = buildGroupMapFromMatches(state.matches);
  const conflictMap = buildTeamConflictMap(state.matches);
  const strictDraw = generateConstrainedDraw(state.participants.length, groupMap, conflictMap);
  let draw = strictDraw;
  if (!draw && !strictOnly) {
    // Fallback for rapid rolling when fixture conflict graph is too constrained.
    draw = generateConstrainedDraw(state.participants.length, groupMap, new Map());
    if (draw) {
      window.alert(
        'Rolled with group safety, but strict self-vs-self fixture avoidance was not possible this attempt.',
      );
    }
  }
  if (!draw && !strictOnly) {
    draw = generateBasicSeedDraw(state.participants.length);
    if (draw) {
      window.alert(
        'Rolled using basic seed assignment fallback to avoid failure. Teams still remain one per seed.',
      );
    }
  }
  if (!draw) {
    window.alert(
      strictOnly
        ? 'Could not produce a lock-safe draw. Try Roll Teams again, then lock once no clashes remain.'
        : 'Could not produce a valid draw at this time. Please click draw again.',
    );
    return false;
  }

  state.participants = state.participants.map((participant, index) => ({
    ...participant,
    teams: draw[index],
  }));
  return true;
}

function generateCheezGroupSafeDraw(participantCount: number): DrawnTeams[] | null {
  if (participantCount < 1 || participantCount > MAX_DRAW_PARTICIPANTS) {
    return null;
  }

  const groupMap = getStaticWorldCupGroupMap();
  const seed1Pool = shuffle([...seeds.seed1]).slice(0, participantCount);
  const seed2Pool = shuffle([...seeds.seed2]).slice(0, participantCount);
  const result: DrawnTeams[] = new Array(participantCount);

  function canPair(team1: string, team2: string): boolean {
    const g1 = groupMap.get(normalizeTeamName(team1));
    const g2 = groupMap.get(normalizeTeamName(team2));
    if (!g1 || !g2) {
      return false;
    }
    return g1 !== g2;
  }

  function solve(index: number, remainingSeed2: string[]): boolean {
    if (index >= participantCount) {
      return true;
    }
    const seed1Team = seed1Pool[index];
    const candidates = shuffle(remainingSeed2.filter((team2) => canPair(seed1Team, team2)));
    for (const team2 of candidates) {
      result[index] = { seed1: seed1Team, seed2: team2 };
      const nextSeed2 = remainingSeed2.filter((team) => team !== team2);
      if (solve(index + 1, nextSeed2)) {
        return true;
      }
    }
    return false;
  }

  return solve(0, seed2Pool) ? result : null;
}

function getStaticWorldCupGroupMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of WORLD_CUP_GROUPS) {
    for (const team of group.teams) {
      map.set(normalizeTeamName(team), group.name);
    }
  }
  return map;
}
function generateConstrainedDraw(
  participantCount: number,
  groupMap: Map<string, string>,
  conflictMap: Map<string, Set<string>>,
): DrawnTeams[] | null {
  const otherSeedKeys = ACTIVE_SEED_KEYS.filter((seedKey) => seedKey !== 'seed1');
  let seed1Assigned = shuffle([...seeds.seed1]).slice(0, participantCount);

  function areDifferentGroups(teamA: string, teamB: string): boolean {
    const groupA = groupMap.get(normalizeTeamName(teamA));
    const groupB = groupMap.get(normalizeTeamName(teamB));
    if (!groupA || !groupB) {
      // If group data is not published yet for a team, do not hard-fail rolling.
      return true;
    }
    return groupA !== groupB;
  }

  function canPair(teamA: string, teamB: string): boolean {
    return areDifferentGroups(teamA, teamB) && areTeamsNonConflicting(teamA, teamB, conflictMap);
  }

  const maxAttempts = ACTIVE_SEED_KEYS.length >= 4 ? 1200 : 500;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0 && attempt % 8 === 0) {
      seed1Assigned = shuffle([...seeds.seed1]).slice(0, participantCount);
    }

    const pools: Partial<Record<SeedKey, string[]>> = {};
    for (const seedKey of otherSeedKeys) {
      pools[seedKey] = shuffle([...seeds[seedKey]]);
    }

    const order = shuffle(Array.from({ length: participantCount }, (_, i) => i));
    const staged: Array<DrawnTeams | null> = new Array(participantCount).fill(null);
    let failed = false;

    for (const participantIndex of order) {
      const assignment: Partial<Record<SeedKey, string>> = {
        seed1: seed1Assigned[participantIndex],
      };

      for (let seedIndex = 0; seedIndex < otherSeedKeys.length; seedIndex += 1) {
        const seedKey = otherSeedKeys[seedIndex];
        const pool = pools[seedKey] ?? [];
        const alreadyAssigned = Object.values(assignment).filter((value): value is string =>
          Boolean(value),
        );
        const candidates = shuffle(
          pool.filter((candidate) => alreadyAssigned.every((team) => canPair(team, candidate))),
        );
        if (candidates.length === 0) {
          failed = true;
          break;
        }

        let bestCandidate = candidates[0];
        let bestScore = -1;
        for (const candidate of candidates) {
          const trialAssigned = [...alreadyAssigned, candidate];
          let score = 0;
          let viable = true;
          for (let next = seedIndex + 1; next < otherSeedKeys.length; next += 1) {
            const nextPool = pools[otherSeedKeys[next]] ?? [];
            const compatible = nextPool.filter((team) => trialAssigned.every((t) => canPair(t, team)))
              .length;
            if (compatible === 0) {
              viable = false;
              break;
            }
            score += Math.min(compatible, 6);
          }
          if (viable && score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
          }
        }

        assignment[seedKey] = bestCandidate;
        pools[seedKey] = pool.filter((team) => team !== bestCandidate);
      }

      if (failed) {
        break;
      }

      const drawEntry: DrawnTeams = {
        seed1: assignment.seed1!,
        seed2: assignment.seed2!,
        ...(assignment.seed3 ? { seed3: assignment.seed3 } : {}),
        ...(assignment.seed4 ? { seed4: assignment.seed4 } : {}),
      };
      staged[participantIndex] = drawEntry;
    }

    if (!failed && staged.every((entry): entry is DrawnTeams => Boolean(entry))) {
      return staged;
    }
  }

  return null;
}

function generateBasicSeedDraw(participantCount: number): DrawnTeams[] | null {
  if (participantCount < 1 || participantCount > MAX_DRAW_PARTICIPANTS) {
    return null;
  }

  const pools: Partial<Record<SeedKey, string[]>> = {};
  for (const seedKey of ACTIVE_SEED_KEYS) {
    pools[seedKey] = shuffle([...seeds[seedKey]]).slice(0, participantCount);
  }

  return Array.from({ length: participantCount }, (_, index) => {
    const drawEntry: DrawnTeams = {
      seed1: pools.seed1![index],
      seed2: pools.seed2![index],
    };
    if ((pools.seed3?.length ?? 0) > 0) {
      drawEntry.seed3 = pools.seed3![index];
    }
    if ((pools.seed4?.length ?? 0) > 0) {
      drawEntry.seed4 = pools.seed4![index];
    }
    return drawEntry;
  });
}

function clearDrawOnly(): void {
  if (!requireAdminAccess('clear draw')) {
    return;
  }
  state.participants = state.participants.map((participant) => ({
    ...participant,
    teams: undefined,
  }));
  state.locked = false;
  state.drawCompletedAt = null;
  saveAndRender();
}

function resetAll(): void {
  if (!requireAdminAccess('reset sweepstake')) {
    return;
  }
  if (IS_CHEEZ_ROOM) {
    const confirmed = window.confirm('Reset draw only and keep all names?');
    if (!confirmed) {
      return;
    }
    state.participants = state.participants.map((participant) => ({
      ...participant,
      teams: undefined,
    }));
    state.locked = false;
    state.drawCompletedAt = null;
    saveAndRender();
    return;
  }
  const confirmed = window.confirm('Reset all participants, draw results, and synced match data?');
  if (!confirmed) {
    return;
  }
  state = {
    participants: [],
    matches: [],
    locked: false,
    drawCompletedAt: null,
  };
  selectedParticipantId = null;
  localStorage.removeItem(SELECTED_PROFILE_KEY);
  saveAndRender();
  void syncApiMatches(true);
}

function removePlayer(id: string): void {
  if (!requireAdminAccess('remove player')) {
    return;
  }
  if (!id) {
    return;
  }
  state.participants = state.participants.filter((p) => p.id !== id);
  if (selectedParticipantId === id) {
    selectedParticipantId = null;
    localStorage.removeItem(SELECTED_PROFILE_KEY);
  }
  saveAndRender();
}

async function unlockAdminControls(): Promise<void> {
  if (!supabase) {
    window.alert('Admin unlock requires Supabase to be configured.');
    return;
  }
  const entered = window.prompt('Enter admin PIN');
  if (entered === null) {
    return;
  }
  const valid = await verifyAdminPin(entered);
  if (!valid) {
    window.alert('Invalid PIN.');
    return;
  }
  adminUnlocked = true;
  render();
}

async function verifyAdminPin(pin: string): Promise<boolean> {
  try {
    if (!supabase) {
      return false;
    }
    const { data, error } = await supabase.rpc('verify_admin_pin', {
      room_input: SUPABASE_ROOM_ID,
      pin_input: pin,
    });
    if (error) {
      cloudSyncError = formatCloudError(error);
      render();
      return false;
    }
    return Boolean(data);
  } catch {
    return false;
  }
}

function lockAdminControls(): void {
  adminUnlocked = false;
  render();
}

function requireAdminAccess(action: string): boolean {
  if (adminUnlocked) {
    return true;
  }
  window.alert(`Admin PIN required to ${action}.`);
  return false;
}

async function syncApiMatches(forceRender = false): Promise<void> {
  if (syncState.loading) {
    return;
  }
  if (!forceRender && Date.now() < liveCooldownUntil) {
    return;
  }
  syncState.loading = true;
  syncState.error = null;
  if (forceRender) {
    render();
  }
  try {
    const apiMatches = await fetchWorldCupMatches();
    // Merge API->API only. Never merge with cloud/localStorage match junk.
    lastFetchedApiMatches = mergeApiMatches(lastFetchedApiMatches, apiMatches);
    state.matches = getAuthoritativeMatches(state.matches);
    syncState.lastSyncedAt = new Date().toISOString();
    liveFailureCount = 0;
    liveCooldownUntil = 0;
    // Matches stay local; participants/draw are pushed only by user actions.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
  } catch (error) {
    syncState.error = error instanceof Error ? error.message : 'Unknown sync error';
    liveFailureCount += 1;
    const backoffMs = Math.min(5 * 60 * 1000, 15_000 * 2 ** Math.min(liveFailureCount, 5));
    liveCooldownUntil = Date.now() + backoffMs;
    render();
  } finally {
    syncState.loading = false;
    render();
  }
}

async function fetchWorldCupMatches(): Promise<Match[]> {
  const seasonUrl = `https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=${WORLD_CUP_LEAGUE_ID}&s=${WORLD_CUP_TARGET_SEASON}`;
  const nextLeagueUrl = `https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${WORLD_CUP_LEAGUE_ID}`;
  const pastLeagueUrl = `https://www.thesportsdb.com/api/v1/json/123/eventspastleague.php?id=${WORLD_CUP_LEAGUE_ID}`;
  const [seasonPayload, nextLeaguePayload, pastLeaguePayload] = await Promise.all([
    fetchJsonWithFallback<{ events?: ApiEvent[] }>(seasonUrl).catch(() => ({ events: [] })),
    fetchJsonWithFallback<{ events?: ApiEvent[] }>(nextLeagueUrl).catch(() => ({ events: [] })),
    fetchJsonWithFallback<{ events?: ApiEvent[] }>(pastLeagueUrl).catch(() => ({ events: [] })),
  ]);
  const roundPayloads = await Promise.all(
    WORLD_CUP_FETCH_ROUNDS.map(async (round) => {
      const roundUrl = `https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=${WORLD_CUP_LEAGUE_ID}&r=${round}&s=${WORLD_CUP_TARGET_SEASON}`;
      try {
        const payload = await fetchJsonWithFallback<{ events?: ApiEvent[] }>(roundUrl);
        return payload.events ?? [];
      } catch {
        return [];
      }
    }),
  );

  const eventMap = new Map<string, ApiEvent>();
  [
    ...(seasonPayload.events ?? []),
    ...(nextLeaguePayload.events ?? []),
    ...(pastLeaguePayload.events ?? []),
    ...roundPayloads.flat(),
  ].forEach((event) => {
    if (event.idEvent) {
      eventMap.set(event.idEvent, event);
      return;
    }
    eventMap.set(`${event.strHomeTeam}-${event.strAwayTeam}-${event.dateEvent}-${event.strTime}`, event);
  });
  const events = [...eventMap.values()];
  const filtered = events.filter((event) => {
    if (event.idLeague && event.idLeague !== WORLD_CUP_LEAGUE_ID) {
      return false;
    }
    const home = normalizeTeamName(event.strHomeTeam ?? '');
    const away = normalizeTeamName(event.strAwayTeam ?? '');
    return normalizedTeamSet.has(home) || normalizedTeamSet.has(away);
  });

  return filtered.map(mapEventToMatch).map(normalizeMatchRecord);
}

async function fetchJsonWithFallback<T>(url: string): Promise<T> {
  try {
    const directResponse = await fetch(url);
    if (directResponse.ok) {
      try {
        return await parseResponseJson<T>(directResponse);
      } catch {
        // Continue to proxy fallback when body is non-JSON despite 200.
      }
    }
  } catch {
    // Ignore direct fetch failures and try proxy fallback.
  }

  const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
  const proxyResponse = await fetch(proxyUrl);
  if (!proxyResponse.ok) {
    throw new Error(`Live feed unavailable (${proxyResponse.status})`);
  }
  try {
    return await parseResponseJson<T>(proxyResponse);
  } catch {
    throw new Error('Live feed temporarily unavailable');
  }
}

async function parseResponseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('Non-JSON response');
  }
}

function combineMatchRecords(stored: Match, incoming: Match): Match {
  const preferIncomingScores =
    incoming.homeScore !== null &&
    incoming.awayScore !== null &&
    (incoming.status === 'finished' ||
      incoming.status === 'live' ||
      stored.homeScore === null ||
      stored.awayScore === null);

  const merged: Match = {
    ...stored,
    ...incoming,
    homeScore: preferIncomingScores ? incoming.homeScore : (incoming.homeScore ?? stored.homeScore),
    awayScore: preferIncomingScores ? incoming.awayScore : (incoming.awayScore ?? stored.awayScore),
    homePenalties: incoming.homePenalties ?? stored.homePenalties ?? null,
    awayPenalties: incoming.awayPenalties ?? stored.awayPenalties ?? null,
    status:
      incoming.status === 'finished' || stored.status === 'finished'
        ? 'finished'
        : incoming.status === 'live' || stored.status === 'live'
          ? 'live'
          : incoming.status,
  };

  if (matchDecidedByPenalties(merged)) {
    merged.status = 'finished';
  }

  return normalizeMatchRecord(merged);
}

function normalizeMatchRecord(match: Match): Match {
  const normalized: Match = { ...match };

  if (matchDecidedByPenalties(normalized)) {
    normalized.status = 'finished';
    return normalized;
  }

  if (
    normalized.homeScore !== null &&
    normalized.awayScore !== null &&
    normalized.status === 'live'
  ) {
    const kickoffMs = kickoffToDate(normalized.kickoff).getTime();
    if (Number.isFinite(kickoffMs) && kickoffMs <= Date.now() - 2 * 60 * 60 * 1000) {
      normalized.status = 'finished';
    }
  }

  return normalized;
}

function isResolvedFinishedMatch(match: Match): boolean {
  const normalized = normalizeMatchRecord(match);
  return (
    normalized.status === 'finished' &&
    normalized.homeScore !== null &&
    normalized.awayScore !== null
  );
}

function scoreParticipantSide(
  match: Match,
  side: 'home' | 'away',
  totals: {
    points: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  },
): void {
  const gf = side === 'home' ? match.homeScore! : match.awayScore!;
  const ga = side === 'home' ? match.awayScore! : match.homeScore!;
  totals.goalsFor += gf;
  totals.goalsAgainst += ga;
  totals.points += gf * POINTS.goalBonus;

  const outcome = getSideOutcome(match, side);
  if (outcome === 'win') {
    totals.wins += 1;
    totals.points += POINTS.win;
  } else if (outcome === 'draw') {
    totals.draws += 1;
    totals.points += POINTS.draw;
  } else {
    totals.losses += 1;
  }

  if (ga === 0 && outcome === 'win') {
    totals.points += POINTS.cleanSheet;
  }
}

function mergeApiMatches(existing: Match[], incomingApiMatches: Match[]): Match[] {
  const manualMatches = existing.filter((m) => m.source === 'manual');
  const existingApiById = new Map(
    existing
      .filter((m) => m.source === 'api')
      .map((m) => [m.id, m] as const),
  );
  const incomingById = new Map(incomingApiMatches.map((m) => [m.id, m] as const));

  for (const [id, incoming] of incomingById.entries()) {
    const stored = existingApiById.get(id);
    existingApiById.set(
      id,
      stored ? normalizeMatchRecord(combineMatchRecords(stored, incoming)) : normalizeMatchRecord(incoming),
    );
  }

  return [...manualMatches, ...existingApiById.values()].sort(
    (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime(),
  );
}

function buildGroupMapFromMatches(matches: Match[]): Map<string, string> {
  const relevant = matches.filter(
    (match) =>
      match.source === 'api' &&
      match.round !== null &&
      match.round <= GROUP_STAGE_ROUNDS[GROUP_STAGE_ROUNDS.length - 1] &&
      normalizedTeamSet.has(normalizeTeamName(match.homeTeam)) &&
      normalizedTeamSet.has(normalizeTeamName(match.awayTeam)),
  );

  const adjacency = new Map<string, Set<string>>();
  for (const match of relevant) {
    const home = normalizeTeamName(match.homeTeam);
    const away = normalizeTeamName(match.awayTeam);
    const homeNeighbors = adjacency.get(home) ?? new Set<string>();
    homeNeighbors.add(away);
    adjacency.set(home, homeNeighbors);
    const awayNeighbors = adjacency.get(away) ?? new Set<string>();
    awayNeighbors.add(home);
    adjacency.set(away, awayNeighbors);
  }

  const visited = new Set<string>();
  const groupMap = new Map<string, string>();
  let groupCounter = 1;

  for (const team of adjacency.keys()) {
    if (visited.has(team)) {
      continue;
    }
    const queue = [team];
    const component: string[] = [];
    visited.add(team);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const neighbors = adjacency.get(current) ?? new Set<string>();
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    const label = `GROUP_${groupCounter}`;
    groupCounter += 1;
    for (const member of component) {
      groupMap.set(member, label);
    }
  }

  return groupMap;
}

function buildTeamConflictMap(matches: Match[]): Map<string, Set<string>> {
  const conflictMap = new Map<string, Set<string>>();
  const relevant = matches.filter(
    (match) =>
      match.source === 'api' &&
      normalizedTeamSet.has(normalizeTeamName(match.homeTeam)) &&
      normalizedTeamSet.has(normalizeTeamName(match.awayTeam)),
  );

  for (const match of relevant) {
    const home = normalizeTeamName(match.homeTeam);
    const away = normalizeTeamName(match.awayTeam);
    const homeSet = conflictMap.get(home) ?? new Set<string>();
    homeSet.add(away);
    conflictMap.set(home, homeSet);
    const awaySet = conflictMap.get(away) ?? new Set<string>();
    awaySet.add(home);
    conflictMap.set(away, awaySet);
  }

  return conflictMap;
}

function areTeamsNonConflicting(
  teamA: string,
  teamB: string,
  conflictMap: Map<string, Set<string>>,
): boolean {
  const a = normalizeTeamName(teamA);
  const b = normalizeTeamName(teamB);
  return !(conflictMap.get(a)?.has(b) ?? false);
}

interface ApiEvent {
  idEvent?: string;
  idLeague?: string;
  intRound?: string | number | null;
  strHomeTeam?: string;
  strAwayTeam?: string;
  strTimestamp?: string;
  dateEvent?: string;
  strTime?: string;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  intHomeScoreExtra?: string | number | null;
  intAwayScoreExtra?: string | number | null;
  strResult?: string | null;
  strStatus?: string;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
}

function mapEventToMatch(event: ApiEvent): Match {
  const idEvent = event.idEvent ?? crypto.randomUUID();
  const kickoff = resolveKickoff(event);
  const homeTeam = prettifyTeamName(event.strHomeTeam ?? 'Unknown');
  const awayTeam = prettifyTeamName(event.strAwayTeam ?? 'Unknown');
  const homeScore = parseApiScore(event.intHomeScore);
  const awayScore = parseApiScore(event.intAwayScore);
  const { homePenalties, awayPenalties } = parsePenaltyScores(event);
  const status = inferEventStatus(event.strStatus ?? '', homeScore, awayScore, kickoff);

  return {
    id: `api-${idEvent}`,
    apiEventId: idEvent,
    kickoff,
    homeTeam,
    awayTeam,
    status,
    homeScore,
    awayScore,
    homePenalties,
    awayPenalties,
    source: 'api',
    round: parseRound(event.intRound),
    homeBadge: event.strHomeTeamBadge ?? null,
    awayBadge: event.strAwayTeamBadge ?? null,
  };
}

function parsePenaltyScores(event: ApiEvent): {
  homePenalties: number | null;
  awayPenalties: number | null;
} {
  const status = (event.strStatus ?? '').toUpperCase().trim();
  const resultText = (event.strResult ?? '').toLowerCase();
  const isPenaltyDecided =
    ['AP', 'PEN'].includes(status) ||
    resultText.includes('penalt') ||
    (parseApiScore(event.intHomeScore) === parseApiScore(event.intAwayScore) &&
      parseApiScore(event.intHomeScoreExtra) !== null &&
      parseApiScore(event.intAwayScoreExtra) !== null &&
      parseApiScore(event.intHomeScoreExtra) !== parseApiScore(event.intAwayScoreExtra));
  if (!isPenaltyDecided) {
    return { homePenalties: null, awayPenalties: null };
  }

  const homePenalties = parseApiScore(event.intHomeScoreExtra);
  const awayPenalties = parseApiScore(event.intAwayScoreExtra);
  if (homePenalties === null || awayPenalties === null || homePenalties === awayPenalties) {
    return { homePenalties: null, awayPenalties: null };
  }

  return { homePenalties, awayPenalties };
}

function matchDecidedByPenalties(match: Match): boolean {
  return (
    match.homePenalties !== null &&
    match.awayPenalties !== null &&
    match.homePenalties !== match.awayPenalties
  );
}

function getSideOutcome(match: Match, side: 'home' | 'away'): 'win' | 'draw' | 'loss' {
  if (match.homeScore === null || match.awayScore === null) {
    return 'draw';
  }

  const goalsFor = side === 'home' ? match.homeScore : match.awayScore;
  const goalsAgainst = side === 'home' ? match.awayScore : match.homeScore;

  if (matchDecidedByPenalties(match)) {
    const homeWon = match.homePenalties! > match.awayPenalties!;
    if (side === 'home') {
      return homeWon ? 'win' : 'loss';
    }
    return homeWon ? 'loss' : 'win';
  }

  if (goalsFor > goalsAgainst) {
    return 'win';
  }
  if (goalsFor === goalsAgainst) {
    return 'draw';
  }
  return 'loss';
}

function parseRound(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

function inferEventStatus(
  rawStatus: string,
  homeScore: number | null,
  awayScore: number | null,
  kickoffIso: string,
): MatchStatus {
  const hasScores = homeScore !== null && awayScore !== null;
  if (rawStatus.trim()) {
    const mapped = mapApiStatus(rawStatus);
    if (mapped === 'live' && hasScores) {
      const kickoffMs = kickoffToDate(kickoffIso).getTime();
      if (Number.isFinite(kickoffMs) && kickoffMs <= Date.now() - 2 * 60 * 60 * 1000) {
        return 'finished';
      }
    }
    return mapped;
  }
  if (hasScores) {
    return 'finished';
  }
  const kickoffMs = kickoffToDate(kickoffIso).getTime();
  if (!Number.isFinite(kickoffMs)) {
    return 'scheduled';
  }
  return kickoffMs <= Date.now() ? 'live' : 'scheduled';
}

function resolveKickoff(event: ApiEvent): string {
  if (event.strTimestamp) {
    return event.strTimestamp;
  }
  if (event.dateEvent && event.strTime) {
    return `${event.dateEvent}T${event.strTime}`;
  }
  if (event.dateEvent) {
    return `${event.dateEvent}T00:00:00`;
  }
  return new Date().toISOString();
}

function parseApiScore(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function mapApiStatus(rawStatus: string): MatchStatus {
  const status = rawStatus.toUpperCase().trim();
  if (
    ['FT', 'AET', 'AP', 'PEN', 'ABAN', 'MATCH FINISHED', 'FULL TIME', 'FINISHED', 'ENDED'].includes(
      status,
    ) ||
    /\b(FT|AET|AP|PEN|FULL\s*TIME|FINISHED|ENDED)\b/.test(status)
  ) {
    return 'finished';
  }
  if (status === 'AWD' || status === 'WO') {
    return 'finished';
  }
  if (
    ['NS', 'TBD', 'PST', 'CANC', 'POSTPONED', 'DELAYED', 'NOT STARTED', 'SCHEDULED'].includes(
      status,
    )
  ) {
    return 'scheduled';
  }
  return 'live';
}

function getLiveMatches(): Match[] {
  return state.matches.filter((m) => m.status === 'live');
}

function getAssignedTeams(teams: DrawnTeams | undefined): string[] {
  if (!teams) {
    return [];
  }
  return ACTIVE_SEED_KEYS.map((seedKey) => teams[seedKey]).filter(
    (team): team is string => Boolean(team),
  );
}

function getTeamOwnersMap(): Map<string, string[]> {
  const teamOwners = new Map<string, string[]>();
  for (const participant of state.participants) {
    if (!participant.teams) {
      continue;
    }
    for (const team of getAssignedTeams(participant.teams)) {
      const key = normalizeTeamName(team);
      const owners = teamOwners.get(key) ?? [];
      owners.push(participant.name);
      teamOwners.set(key, owners);
    }
  }
  return teamOwners;
}

function getOwnersForTeam(teamName: string, teamOwners: Map<string, string[]>): string[] {
  return teamOwners.get(normalizeTeamName(teamName)) ?? [];
}

function renderMatchOwnerRow(match: Match, teamOwners: Map<string, string[]>): string {
  const homeOwners = getOwnersForTeam(match.homeTeam, teamOwners);
  const awayOwners = getOwnersForTeam(match.awayTeam, teamOwners);
  if (homeOwners.length > 0 && awayOwners.length > 0) {
    return `
      <div class="owners-vs-row">
        <span class="owner-chip">🎯 ${escapeHtml(formatOwners(homeOwners))}</span>
        <span class="owner-vs">VS</span>
        <span class="owner-chip">🎯 ${escapeHtml(formatOwners(awayOwners))}</span>
      </div>
    `;
  }
  const anyOwners = [...new Set([...homeOwners, ...awayOwners])];
  if (anyOwners.length > 0) {
    return `<div class="owners-row">${anyOwners
      .map((owner) => `<span class="owner-chip">🎯 ${escapeHtml(owner)}</span>`)
      .join('')}</div>`;
  }
  return '<div class="owners-row"><span class="owner-chip muted">No sweepstake owner in this live game</span></div>';
}

function getPreviousMatchLimit(upcomingCount: number): number {
  if (upcomingCount === 0) {
    return 8;
  }
  const singleColumnUpcoming =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches;
  return singleColumnUpcoming ? upcomingCount : Math.ceil(upcomingCount / 2);
}

function renderUpcomingMatchCard(match: Match, teamOwners: Map<string, string[]>): string {
  const homeOwners = getOwnersForTeam(match.homeTeam, teamOwners);
  const awayOwners = getOwnersForTeam(match.awayTeam, teamOwners);
  const homeOwnerLabel = homeOwners.length > 0 ? formatOwners(homeOwners) : 'Unowned';
  const awayOwnerLabel = awayOwners.length > 0 ? formatOwners(awayOwners) : 'Unowned';

  return `
    <article class="vs-item upcoming-card">
      <div class="upcoming-date-row" title="${escapeHtml(formatDateTime(match.kickoff))}">
        ${formatKickoffLocalShort(match.kickoff)}
      </div>
      <div class="upcoming-duel">
        <div class="upcoming-side home">
          <div class="upcoming-owner" title="${escapeHtml(homeOwnerLabel)}">${escapeHtml(homeOwnerLabel)}</div>
          <div class="upcoming-team" title="${escapeHtml(match.homeTeam)}">
            ${teamFlagIcon(match.homeTeam)}
            <span>${escapeHtml(match.homeTeam)}</span>
          </div>
        </div>
        <span class="upcoming-vs">VS</span>
        <div class="upcoming-side away">
          <div class="upcoming-owner" title="${escapeHtml(awayOwnerLabel)}">${escapeHtml(awayOwnerLabel)}</div>
          <div class="upcoming-team" title="${escapeHtml(match.awayTeam)}">
            ${teamFlagIcon(match.awayTeam)}
            <span>${escapeHtml(match.awayTeam)}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderPreviousMatchCard(match: Match, teamOwners: Map<string, string[]>): string {
  const homeOwners = getOwnersForTeam(match.homeTeam, teamOwners);
  const awayOwners = getOwnersForTeam(match.awayTeam, teamOwners);
  const homeOwnerLabel = homeOwners.length > 0 ? formatOwners(homeOwners) : 'Unowned';
  const awayOwnerLabel = awayOwners.length > 0 ? formatOwners(awayOwners) : 'Unowned';

  return `
    <article class="vs-item previous-card">
      <div class="upcoming-date-row" title="${escapeHtml(formatDateTime(match.kickoff))}">
        ${formatKickoffLocalShort(match.kickoff)}
      </div>
      <div class="upcoming-duel">
        <div class="upcoming-side home">
          <div class="upcoming-owner" title="${escapeHtml(homeOwnerLabel)}">${escapeHtml(homeOwnerLabel)}</div>
          <div class="upcoming-team" title="${escapeHtml(match.homeTeam)}">
            ${teamFlagIcon(match.homeTeam)}
            <span>${escapeHtml(match.homeTeam)}</span>
          </div>
        </div>
        <span class="final-score" title="${escapeHtml(displayScore(match))}">${escapeHtml(displayScore(match))}</span>
        <div class="upcoming-side away">
          <div class="upcoming-owner" title="${escapeHtml(awayOwnerLabel)}">${escapeHtml(awayOwnerLabel)}</div>
          <div class="upcoming-team" title="${escapeHtml(match.awayTeam)}">
            ${teamFlagIcon(match.awayTeam)}
            <span>${escapeHtml(match.awayTeam)}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function formatOwners(owners: string[]): string {
  return owners.join(' + ');
}

function getMatchOwners(match: Match, teamOwners: Map<string, string[]>): string[] {
  const names = new Set<string>();
  const homeOwners = teamOwners.get(normalizeTeamName(match.homeTeam)) ?? [];
  const awayOwners = teamOwners.get(normalizeTeamName(match.awayTeam)) ?? [];
  [...homeOwners, ...awayOwners].forEach((owner) => names.add(owner));
  return [...names];
}

function isSweepstakeMatch(match: Match, teamOwners: Map<string, string[]>): boolean {
  return getMatchOwners(match, teamOwners).length > 0;
}

function getPersonalMatchesFromMatches(
  sourceMatches: Match[],
  teams: DrawnTeams,
): PersonalMatch[] {
  const teamSet = new Set(getAssignedTeams(teams).map(normalizeTeamName));
  return sourceMatches
    .filter((match) => {
      const home = normalizeTeamName(match.homeTeam);
      const away = normalizeTeamName(match.awayTeam);
      return teamSet.has(home) || teamSet.has(away);
    })
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
    .map((match) => {
      const isHome = teamSet.has(normalizeTeamName(match.homeTeam));
      return {
        ...match,
        personalTeam: isHome ? match.homeTeam : match.awayTeam,
        opponent: isHome ? match.awayTeam : match.homeTeam,
      };
    });
}

function getWorldCupGroupTeamMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of WORLD_CUP_GROUPS) {
    for (const team of group.teams) {
      map.set(normalizeTeamName(team), group.name);
    }
  }
  return map;
}

function buildWorldCupGroupStandings(matches: Match[]): Map<string, GroupTeamStanding[]> {
  const teamToGroup = getWorldCupGroupTeamMap();
  const standingsByGroup = new Map<string, Map<string, GroupTeamStanding>>();

  for (const group of WORLD_CUP_GROUPS) {
    const teamMap = new Map<string, GroupTeamStanding>();
    for (const team of group.teams) {
      teamMap.set(normalizeTeamName(team), {
        team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
      });
    }
    standingsByGroup.set(group.name, teamMap);
  }

  for (const match of matches) {
    if (match.status !== 'finished' || match.homeScore === null || match.awayScore === null) {
      continue;
    }
    if (match.round === null || match.round > GROUP_STAGE_ROUNDS[GROUP_STAGE_ROUNDS.length - 1]) {
      continue;
    }

    const homeKey = normalizeTeamName(match.homeTeam);
    const awayKey = normalizeTeamName(match.awayTeam);
    const groupName = teamToGroup.get(homeKey);
    if (!groupName || teamToGroup.get(awayKey) !== groupName) {
      continue;
    }

    const groupStandings = standingsByGroup.get(groupName);
    const home = groupStandings?.get(homeKey);
    const away = groupStandings?.get(awayKey);
    if (!home || !away) {
      continue;
    }

    const homeGoals = match.homeScore;
    const awayGoals = match.awayScore;
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (homeGoals < awayGoals) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  const result = new Map<string, GroupTeamStanding[]>();
  for (const group of WORLD_CUP_GROUPS) {
    const sorted = [...(standingsByGroup.get(group.name)?.values() ?? [])].sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }
      const goalDiffA = a.goalsFor - a.goalsAgainst;
      const goalDiffB = b.goalsFor - b.goalsAgainst;
      if (goalDiffB !== goalDiffA) {
        return goalDiffB - goalDiffA;
      }
      if (b.goalsFor !== a.goalsFor) {
        return b.goalsFor - a.goalsFor;
      }
      return a.team.localeCompare(b.team);
    });
    result.set(group.name, sorted);
  }

  return result;
}

function applyGroupsSearchFilter(): void {
  const query = groupsSearchQuery.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>('.group-card').forEach((card) => {
    let visibleRows = 0;
    card.querySelectorAll<HTMLElement>('.group-standing-row').forEach((row) => {
      const team = row.dataset.team ?? '';
      const owner = row.dataset.owner ?? '';
      const matches = !query || team.includes(query) || owner.includes(query);
      row.hidden = !matches;
      if (matches) {
        visibleRows += 1;
      }
    });
    card.hidden = query.length > 0 && visibleRows === 0;
  });
}

function buildLeaderboard(): Array<{
  name: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}> {
  if (!state.locked) {
    return [];
  }
  const finished = state.matches.filter((match) => isResolvedFinishedMatch(match));
  const rows = state.participants
    .filter((p) => Boolean(p.teams))
    .map((participant) => {
      const teams = getAssignedTeams(participant.teams!).map(normalizeTeamName);
      const totals = {
        points: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      };

      for (const rawMatch of finished) {
        const match = normalizeMatchRecord(rawMatch);
        const home = normalizeTeamName(match.homeTeam);
        const away = normalizeTeamName(match.awayTeam);

        for (const side of ['home', 'away'] as const) {
          const team = side === 'home' ? home : away;
          if (!teams.includes(team)) {
            continue;
          }
          scoreParticipantSide(match, side, totals);
        }
      }

      return {
        name: participant.name,
        points: totals.points,
        wins: totals.wins,
        draws: totals.draws,
        losses: totals.losses,
        goalsFor: totals.goalsFor,
        goalsAgainst: totals.goalsAgainst,
      };
    });

  return rows.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    const gdA = a.goalsFor - a.goalsAgainst;
    const gdB = b.goalsFor - b.goalsAgainst;
    if (gdB !== gdA) {
      return gdB - gdA;
    }
    return b.goalsFor - a.goalsFor;
  });
}

function displayScore(match: Match): string {
  if (match.homeScore === null || match.awayScore === null) {
    return 'vs';
  }
  const base = `${match.homeScore} - ${match.awayScore}`;
  if (!matchDecidedByPenalties(match)) {
    return base;
  }
  return `${base} (${match.homePenalties}-${match.awayPenalties} pens)`;
}

function teamBadge(url: string | null | undefined, team: string): string {
  if (!url) {
    return `<span class="team-placeholder">${escapeHtml(team.slice(0, 3).toUpperCase())}</span>`;
  }
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(team)} badge" class="team-badge" />`;
}

function statusChip(status: MatchStatus): string {
  const label = status[0].toUpperCase() + status.slice(1);
  return `<span class="chip ${status}">${label}</span>`;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function formatDateTime(value: string): string {
  const date = kickoffToDate(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function formatUtcDateTime(value: string): string {
  const date = kickoffToDate(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(date);
}

function formatDateOnly(value: string): string {
  const date = kickoffToDate(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatKickoffLocalShort(value: string): string {
  const date = kickoffToDate(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function formatSyncAge(lastSyncedAt: string): string {
  const last = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(last)) {
    return 'just now';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - last) / 1000));
  if (seconds < 5) {
    return 'just now';
  }
  return `${seconds}s ago`;
}

function getViewerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Local Time';
}

function kickoffToDate(value: string): Date {
  const trimmed = value.trim();
  if (!trimmed) {
    return new Date(value);
  }
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed);
  if (hasTimezone) {
    return new Date(trimmed);
  }
  return new Date(`${trimmed}Z`);
}

function teamFlagCode(teamName: string): string | null {
  const code = TEAM_FLAG_CODES[normalizeTeamName(teamName)];
  if (!code || code.length !== 2) {
    return null;
  }
  return code.toLowerCase();
}

function teamFlagIcon(teamName: string): string {
  const code = teamFlagCode(teamName);
  if (!code) {
    return `<span class="team-flag-fallback">🏳️</span>`;
  }
  const safeTeam = escapeHtml(teamName);
  return `<img class="flag-icon" src="https://flagcdn.com/w40/${code}.png" srcset="https://flagcdn.com/w80/${code}.png 2x" alt="${safeTeam} flag" loading="lazy" />`;
}

function normalizeTeamName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replaceAll('&', 'and')
    .replaceAll('.', '')
    .replaceAll("'", '')
    .replaceAll('’', '')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .replace('usa', 'united states')
    .replace('korea republic', 'south korea')
    .replace('ir iran', 'iran')
    .replace('cote divoire', 'ivory coast')
    .replace('curacao', 'curacao')
    .replace('ivory coast', 'ivory coast')
    .replace('dr congo', 'dr congo');

  const aliases: Record<string, string> = {
    'cabo verde': 'cape verde',
    'curaçao': 'curacao',
    'bosnia herzegovina': 'bosnia and herzegovina',
    'bosnia-herzegovina': 'bosnia and herzegovina',
    bosnia: 'bosnia and herzegovina',
    congo: 'dr congo',
    czechia: 'czech republic',
    chechia: 'czech republic',
  };

  return aliases[normalized] ?? normalized;
}

function prettifyTeamName(value: string): string {
  const normalized = normalizeTeamName(value);
  const match = allTeams.find((team) => normalizeTeamName(team) === normalized);
  return match ?? value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
