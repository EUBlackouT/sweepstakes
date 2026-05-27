import './style.css';
import { getSupabaseClient, SUPABASE_ROOM_ID } from './supabase';

type SeedKey = 'seed1' | 'seed2' | 'seed3' | 'seed4';
type MatchStatus = 'scheduled' | 'live' | 'finished';
type MatchSource = 'manual' | 'api';

interface DrawnTeams {
  seed1: string;
  seed2: string;
  seed3: string;
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

interface SyncState {
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

interface PersonalMatch extends Match {
  personalTeam: string;
  opponent: string;
}

interface SweepstakeFaceOff {
  match: Match;
  homeOwners: string[];
  awayOwners: string[];
}

interface AppStateRow {
  room_id: string;
  app_state: AppState;
  updated_at: string;
}

const STORAGE_KEY = 'world-cup-sweepstake-v2';
const SELECTED_PROFILE_KEY = 'sweepstake-selected-profile';
const LEGACY_ADMIN_SESSION_KEY = 'sweepstake-admin-unlocked';
const WORLD_CUP_LEAGUE_ID = '4429';
const WORLD_CUP_TARGET_SEASON = '2026';
const SYNC_INTERVAL_MS = 30_000;
const CLOUD_SYNC_INTERVAL_MS = 4_000;
const SIDE_LEFT_IMAGE = (import.meta.env.VITE_SIDE_LEFT_IMAGE as string | undefined) ?? '/side-left.jpg';
const SIDE_RIGHT_IMAGE =
  (import.meta.env.VITE_SIDE_RIGHT_IMAGE as string | undefined) ?? '/side-right.jpg';
const POINTS = {
  win: 3,
  draw: 1,
  cleanSheet: 2,
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

const ROOM_SEED_OVERRIDES: Record<string, Record<SeedKey, string[]>> = {
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
const supabase = getSupabaseClient();
let cloudSyncError: string | null = null;
let cloudSyncStatus: 'disabled' | 'syncing' | 'online' = supabase ? 'syncing' : 'disabled';
let ignoreNextCloudPush = false;
let cloudSubscriptionStarted = false;

render();
void syncApiMatches();
void bootstrapCloudState();
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
    void syncApiMatches();
    void pullCloudState();
  }
});
window.addEventListener('online', () => {
  void syncApiMatches();
  void pullCloudState();
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

    const incoming = sanitizeAppState((data as AppStateRow).app_state);
    if (JSON.stringify(incoming) !== JSON.stringify(state)) {
      ignoreNextCloudPush = true;
      state = incoming;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      ignoreNextCloudPush = false;
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
    const { error } = await supabase.from('sweepstake_state').upsert(
      {
        room_id: SUPABASE_ROOM_ID,
        app_state: state,
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
        const incoming = sanitizeAppState(row.app_state);
        if (JSON.stringify(incoming) === JSON.stringify(state)) {
          return;
        }
        ignoreNextCloudPush = true;
        state = incoming;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        render();
        ignoreNextCloudPush = false;
      },
    )
    .subscribe();
}

function sanitizeAppState(raw: AppState): AppState {
  return {
    participants: raw?.participants ?? [],
    matches: (raw?.matches ?? []).map((match) => ({
      ...match,
      round: match.round ?? null,
    })),
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
  const faceOffs = getSweepstakeFaceOffs(state.matches, teamOwners);
  const liveFaceOffs = faceOffs.filter((entry) => entry.match.status === 'live');
  const upcomingFaceOffs = faceOffs
    .filter(
      (entry) =>
        entry.match.status === 'scheduled' &&
        kickoffToDate(entry.match.kickoff).getTime() >= Date.now(),
    )
    .slice(0, 8);

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
                        <button id="reset-all" class="danger">Reset</button>
                      `
                      : '<span class="hint">Admin draw buttons are hidden until PIN unlock.</span>'
                  }
                </div>
                <p class="hint">Once draw is locked, the interface switches to clean viewer mode with only live sections. This room supports up to ${MAX_DRAW_PARTICIPANTS} players.</p>
              </section>
            `
        }

        <section class="card full participants-section">
          <div class="card-head">
            <h2>Contestants and Assigned Teams</h2>
            ${
              hasDrawResults && adminUnlocked
                ? '<button id="clear-draw" class="ghost small">Clear Current Draw</button>'
                : ''
            }
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
        </section>

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
            <span class="badge">${liveFaceOffs.length} live clashes</span>
          </div>
          ${
            faceOffs.length === 0
              ? '<p class="empty">No player-vs-player fixtures available yet from current World Cup feed.</p>'
              : `
                <div class="vs-board-grid">
                  ${
                    liveFaceOffs.length > 0
                      ? `
                        <div class="vs-column">
                          <p class="hint vs-heading">Live right now</p>
                          <div class="vs-list">
                            ${liveFaceOffs
                              .map(
                                (entry) => `
                                  <article class="vs-item live">
                                    <div class="vs-owners">
                                      <strong>${escapeHtml(formatOwners(entry.homeOwners))}</strong>
                                      <span>VS</span>
                                      <strong>${escapeHtml(formatOwners(entry.awayOwners))}</strong>
                                    </div>
                                    <p>${teamFlagIcon(entry.match.homeTeam)} ${escapeHtml(entry.match.homeTeam)} vs ${teamFlagIcon(entry.match.awayTeam)} ${escapeHtml(entry.match.awayTeam)} • ${displayScore(entry.match)}</p>
                                  </article>
                                `,
                              )
                              .join('')}
                          </div>
                        </div>
                      `
                      : ''
                  }
                  ${
                    upcomingFaceOffs.length > 0
                      ? `
                        <div class="vs-column">
                          <p class="hint vs-heading">Upcoming clashes</p>
                          <div class="vs-list">
                            ${upcomingFaceOffs
                              .map(
                                (entry) => `
                                  <article class="vs-item">
                                    <div class="vs-owners">
                                      <strong>${escapeHtml(formatOwners(entry.homeOwners))}</strong>
                                      <span>VS</span>
                                      <strong>${escapeHtml(formatOwners(entry.awayOwners))}</strong>
                                    </div>
                                    <p>${formatDateTime(entry.match.kickoff)} • ${teamFlagIcon(entry.match.homeTeam)} ${escapeHtml(entry.match.homeTeam)} vs ${teamFlagIcon(entry.match.awayTeam)} ${escapeHtml(entry.match.awayTeam)}</p>
                                  </article>
                                `,
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
              ${state.participants
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

      staged[participantIndex] = {
        seed1: assignment.seed1!,
        seed2: assignment.seed2!,
        seed3: assignment.seed3!,
        ...(assignment.seed4 ? { seed4: assignment.seed4 } : {}),
      };
    }

    if (!failed && staged.every((entry): entry is DrawnTeams => Boolean(entry))) {
      return staged;
    }
  }

  return null;
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
    state.matches = mergeApiMatches(state.matches, apiMatches);
    syncState.lastSyncedAt = new Date().toISOString();
    liveFailureCount = 0;
    liveCooldownUntil = 0;
    // Do not push cloud state on every API poll; that can overwrite
    // participant/draw data from other active clients.
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
  const seasonPayload = await fetchJsonWithFallback<{ events?: ApiEvent[] }>(seasonUrl);
  const roundNumbers = [1, 2, 3];
  const roundPayloads = await Promise.all(
    roundNumbers.map(async (round) => {
      const roundUrl = `https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=${WORLD_CUP_LEAGUE_ID}&r=${round}&s=${WORLD_CUP_TARGET_SEASON}`;
      const payload = await fetchJsonWithFallback<{ events?: ApiEvent[] }>(roundUrl);
      return payload.events ?? [];
    }),
  );

  const eventMap = new Map<string, ApiEvent>();
  [...(seasonPayload.events ?? []), ...roundPayloads.flat()].forEach((event) => {
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

  return filtered.map(mapEventToMatch);
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

function mergeApiMatches(existing: Match[], incomingApiMatches: Match[]): Match[] {
  const manualMatches = existing.filter((m) => m.source === 'manual');
  const existingApiById = new Map(
    existing
      .filter((m) => m.source === 'api')
      .map((m) => [m.id, m] as const),
  );
  const incomingById = new Map(incomingApiMatches.map((m) => [m.id, m] as const));

  for (const [id, incoming] of incomingById.entries()) {
    existingApiById.set(id, incoming);
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
      match.round <= 3 &&
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
    source: 'api',
    round: parseRound(event.intRound),
    homeBadge: event.strHomeTeamBadge ?? null,
    awayBadge: event.strAwayTeamBadge ?? null,
  };
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
    ['FT', 'AET', 'PEN', 'ABAN', 'MATCH FINISHED', 'FULL TIME', 'FINISHED', 'ENDED'].includes(
      status,
    ) ||
    /\b(FT|FULL\s*TIME|FINISHED|ENDED)\b/.test(status)
  ) {
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

function getSweepstakeFaceOffs(
  matches: Match[],
  teamOwners: Map<string, string[]>,
): SweepstakeFaceOff[] {
  const now = Date.now();
  return [...matches]
    .filter((match) => {
      const homeOwners = getOwnersForTeam(match.homeTeam, teamOwners);
      const awayOwners = getOwnersForTeam(match.awayTeam, teamOwners);
      return homeOwners.length > 0 && awayOwners.length > 0;
    })
    .sort((a, b) => {
      const statusScore = (m: Match): number => {
        if (m.status === 'live') {
          return 0;
        }
        if (m.status === 'scheduled') {
          return 1;
        }
        return 2;
      };
      const byStatus = statusScore(a) - statusScore(b);
      if (byStatus !== 0) {
        return byStatus;
      }
      const ta = kickoffToDate(a.kickoff).getTime();
      const tb = kickoffToDate(b.kickoff).getTime();
      return Math.abs(ta - now) - Math.abs(tb - now);
    })
    .map((match) => ({
      match,
      homeOwners: getOwnersForTeam(match.homeTeam, teamOwners),
      awayOwners: getOwnersForTeam(match.awayTeam, teamOwners),
    }));
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
  const finished = state.matches.filter(
    (match) => match.status === 'finished' && match.homeScore !== null && match.awayScore !== null,
  );
  const rows = state.participants
    .filter((p) => Boolean(p.teams))
    .map((participant) => {
      const teams = getAssignedTeams(participant.teams!).map(normalizeTeamName);
      let points = 0;
      let wins = 0;
      let draws = 0;
      let losses = 0;
      let goalsFor = 0;
      let goalsAgainst = 0;

      for (const match of finished) {
        const home = normalizeTeamName(match.homeTeam);
        const away = normalizeTeamName(match.awayTeam);
        const side = teams.includes(home) ? 'home' : teams.includes(away) ? 'away' : null;
        if (!side) {
          continue;
        }
        const gf = side === 'home' ? match.homeScore! : match.awayScore!;
        const ga = side === 'home' ? match.awayScore! : match.homeScore!;
        goalsFor += gf;
        goalsAgainst += ga;
        points += gf * POINTS.goalBonus;

        if (gf > ga) {
          wins += 1;
          points += POINTS.win;
        } else if (gf === ga) {
          draws += 1;
          points += POINTS.draw;
        } else {
          losses += 1;
        }

        if (ga === 0) {
          points += POINTS.cleanSheet;
        }
      }

      return {
        name: participant.name,
        points,
        wins,
        draws,
        losses,
        goalsFor,
        goalsAgainst,
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
  return `${match.homeScore} - ${match.awayScore}`;
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
    .replaceAll('&', 'and')
    .replaceAll('.', '')
    .replaceAll("'", '')
    .replaceAll('’', '')
    .replaceAll('-', ' ')
    .replaceAll('  ', ' ')
    .replace('usa', 'united states')
    .replace('korea republic', 'south korea')
    .replace('ir iran', 'iran')
    .replace('cote divoire', 'ivory coast')
    .replace('bosnia herzegovin', 'bosnia and herzegovina')
    .replace('bosnia-herzegovin', 'bosnia and herzegovina')
    .replace('curacao', 'curacao')
    .replace('ivory coast', 'ivory coast')
    .replace('dr congo', 'dr congo');

  const aliases: Record<string, string> = {
    'cabo verde': 'cape verde',
    'curaçao': 'curacao',
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
