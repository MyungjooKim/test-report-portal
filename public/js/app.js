// ===== State =====
let projectTree = [];
let currentProjectId = null;
let currentReportUrl = null;
let selectedFiles = [];

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  setupUploadZone();
  initSidebarResize();
  initQaLauncher();

  // 뷰어 네비게이션 — iframe 로드 시마다 진행률 리스너 재부착
  const viewerFrameEl = document.getElementById('viewerFrame');
  if (viewerFrameEl) viewerFrameEl.addEventListener('load', initViewerNav);

  document.getElementById('uploadDate').value = new Date().toISOString().slice(0, 10);

  const savedName = localStorage.getItem('uploaderName');
  if (savedName) document.getElementById('uploaderName').value = savedName;

  // 브라우저 뒤로가기/앞으로가기
  window.addEventListener('popstate', () => handleNavigation());

  // 사용자 정보 로드 + 프로젝트 로드
  loadUserInfo();
  loadRuns();
  loadProjects().then(() => handleNavigation());
});

// ===== Sidebar Resize =====
const SIDEBAR_DEFAULT_WIDTH = 340;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 560;

function initSidebarResize() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('sidebarResizer');
  if (!sidebar || !resizer) return;

  const saved = parseInt(localStorage.getItem('sidebarWidth'), 10);
  if (saved >= SIDEBAR_MIN_WIDTH && saved <= SIDEBAR_MAX_WIDTH) {
    sidebar.style.width = saved + 'px';
  }

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;
    document.body.classList.add('sidebar-resizing');

    const onMove = (ev) => {
      const w = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + ev.clientX - startX));
      sidebar.style.width = w + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('sidebar-resizing');
      localStorage.setItem('sidebarWidth', Math.round(sidebar.getBoundingClientRect().width));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  resizer.addEventListener('dblclick', () => {
    sidebar.style.width = SIDEBAR_DEFAULT_WIDTH + 'px';
    localStorage.setItem('sidebarWidth', SIDEBAR_DEFAULT_WIDTH);
  });
}

// ===== [service-hub] 9-dot 앱 런처 — 목록은 tcgen registry 단일 소스(/api/apps 프록시) =====
let QA_CONFIG = null; // { integrated, tcgenUrl }
let QA_APPS_CACHE = null; // /api/apps 응답 캐시 — { apps, hubUrl }
const QA_CURRENT_APP = 'tr';

async function initQaLauncher() {
  QA_CONFIG = await api('/api/config');
  if (QA_CONFIG && QA_CONFIG.integrated) {
    const btn = document.getElementById('launcherBtn');
    if (btn) btn.style.display = 'inline-flex';
  }
  refreshQaApps();
}

async function refreshQaApps() {
  const d = await api('/api/apps');
  if (d && Array.isArray(d.apps) && d.apps.length) QA_APPS_CACHE = d;
}

function qaApps() {
  if (QA_APPS_CACHE) return QA_APPS_CACHE.apps;
  // 서버 목록을 아직 못 받은 극초기/장애 폴백 — 최소 목록
  const tcUrl = (QA_CONFIG && QA_CONFIG.tcgenUrl) || 'http://localhost:5001';
  return [
    { id: 'tc', name: 'Test Case Generator', desc: '기획서 → TC 자동 생성 · 갱신', color: '#3B5BDB', url: tcUrl + '/tc' },
    { id: 'tr', name: 'Test Result Portal',  desc: '테스트 결과 리포트 관리',      color: '#0F9D58', url: '/' },
  ];
}

function toggleLauncher(e) {
  if (e) e.stopPropagation();
  if (document.getElementById('launcherMenu')) { closeLauncher(); return; }
  refreshQaApps(); // 최신 목록 백그라운드 갱신 — 이번 렌더는 캐시 사용
  const overlay = document.createElement('div');
  overlay.id = 'launcherOverlay';
  overlay.onclick = closeLauncher;
  const m = document.createElement('div');
  m.id = 'launcherMenu';
  const head = document.createElement('div');
  head.className = 'lm-head';
  head.textContent = 'PARAMETA · QA TOOLS';
  m.appendChild(head);
  const wrap = document.createElement('div');
  wrap.className = 'lm-apps';
  qaApps().forEach((appDef) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lm-app';
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.style.background = appDef.color;
    ic.textContent = appDef.id.toUpperCase();
    const txt = document.createElement('span');
    const tt = document.createElement('span');
    tt.className = 'tt';
    tt.textContent = appDef.name;
    const ds = document.createElement('span');
    ds.className = 'ds';
    ds.textContent = appDef.desc;
    txt.appendChild(tt);
    txt.appendChild(document.createElement('br'));
    txt.appendChild(ds);
    b.appendChild(ic);
    b.appendChild(txt);
    if (appDef.soon) {
      // 준비 중 — 클릭 불가 (registry 의 soon 플래그가 내려가면 자동 활성화)
      b.disabled = true;
      b.classList.add('lm-soon');
      b.title = appDef.external_auth ? '준비 중 — 오픈 후 별도 로그인이 필요합니다' : '준비 중';
      const cs = document.createElement('span');
      cs.className = 'curmark lm-soonmark';
      cs.textContent = '준비 중';
      b.appendChild(cs);
    } else if (appDef.id === QA_CURRENT_APP) {
      const cur = document.createElement('span');
      cur.className = 'curmark';
      cur.style.color = appDef.color;
      cur.textContent = '● 사용 중';
      b.appendChild(cur);
    } else {
      if (appDef.external_auth) b.title = '별도 로그인이 필요합니다';
      b.onclick = () => { window.location.href = appDef.url; };
    }
    wrap.appendChild(b);
  });
  m.appendChild(wrap);
  // 하단 유틸 — 서비스 선택 허브 이동 · 통합 로그아웃 (TC/TR 만, TC Manager 는 별도 관리)
  const hubUrl = (QA_APPS_CACHE && QA_APPS_CACHE.hubUrl) || (QA_CONFIG && QA_CONFIG.integrated ? QA_CONFIG.tcgenUrl + '/' : '');
  const foot = document.createElement('div');
  foot.className = 'lm-foot';
  if (hubUrl) {
    const hub = document.createElement('button');
    hub.type = 'button';
    hub.className = 'lm-foot-btn';
    hub.textContent = '🏠 서비스 선택';
    hub.onclick = () => { window.location.href = hubUrl; };
    foot.appendChild(hub);
  }
  const lo = document.createElement('button');
  lo.type = 'button';
  lo.className = 'lm-foot-btn lm-logout';
  lo.title = 'TC Generator · TR Portal 통합 로그아웃';
  lo.textContent = '로그아웃';
  lo.onclick = logout;
  foot.appendChild(lo);
  m.appendChild(foot);
  document.body.appendChild(overlay);
  document.body.appendChild(m);
}

function closeLauncher() {
  ['launcherMenu', 'launcherOverlay'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

async function loadUserInfo() {
  const user = await api('/api/me');
  if (user) {
    const el = document.getElementById('userInfo');
    el.innerHTML = `
      <div class="user-row">
        <img class="user-avatar" src="${user.picture || ''}" alt="" referrerpolicy="no-referrer">
        <span class="user-name">${escapeHtml(user.name)}</span>
        <button class="btn-logout" onclick="logout()" title="로그아웃">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    `;
    // 업로더 이름 기본값 설정
    if (!localStorage.getItem('uploaderName')) {
      document.getElementById('uploaderName').value = user.name;
    }
  }
}

function logout() {
  // 서버 /logout 이 세션 파기 + 통합 모드면 tcgen /logout 으로 연쇄 (양쪽 세션 종료)
  window.location.href = '/logout';
}

// ===== Router =====
function handleNavigation() {
  const hash = window.location.hash || '';
  const parts = hash.replace('#', '').split('/');

  if (parts[0] === 'project' && parts[1]) {
    const projectId = parts[1];
    currentProjectId = projectId;
    currentRunId = null;
    renderProjectList();
    renderRunList();

    if (parts[2] === 'report' && parts[3]) {
      loadAndShowReport(projectId, parts[3]);
    } else {
      showProjectView(projectId);
    }
  } else if (parts[0] === 'run' && parts[1]) {
    currentProjectId = null;
    currentRunId = parts[1];
    renderProjectList();
    renderRunList();
    showRunView(parts[1]);
  } else {
    currentProjectId = null;
    currentRunId = null;
    renderProjectList();
    renderRunList();
    showView('dashboard');
  }
}

function navigateTo(hash) {
  history.pushState(null, '', hash);
  handleNavigation();
}

// ===== API Helpers =====
async function api(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    try {
      const d = await res.clone().json();
      if (d && d.need_login) {
        // 통합 모드 세션 만료 — 서버 /login 이 tcgen 로그인으로 위임
        window.location.href = '/login';
        return null;
      }
    } catch (_) {}
  }
  return res.json();
}

// ===== Projects =====
async function loadProjects() {
  projectTree = await api('/api/projects');
  renderProjectList();
  renderDashboard();
}

// 트리 구조를 flat 목록으로 펼치기 (검색 등에 사용)
function flattenTree(tree) {
  const result = [];
  function walk(nodes) {
    for (const node of nodes) {
      result.push(node);
      if (node.children && node.children.length > 0) walk(node.children);
    }
  }
  walk(tree);
  return result;
}

function findProjectInTree(tree, id) {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findProjectInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// 사이드바 트리 렌더링
function renderProjectList() {
  const list = document.getElementById('projectList');
  list.innerHTML = renderTreeNodes(projectTree, 0);
}

function renderTreeNodes(nodes, depth) {
  if (!nodes || nodes.length === 0) return '';

  return nodes.map((p, index) => {
    const isActive = p.id === currentProjectId;
    const hasChildren = p.children && p.children.length > 0;
    const indent = depth * 16;
    const isExpanded = isAncestorOfCurrent(p);

    let html = `
      <li class="tree-item ${isActive ? 'active' : ''}" style="padding-left:${12 + indent}px" data-id="${p.id}" data-parent="${p.parentId || ''}" draggable="true"
        ondragstart="onDragStart(event, '${p.id}')"
        ondragover="onDragOver(event)"
        ondragenter="onDragEnter(event)"
        ondragleave="onDragLeave(event)"
        ondrop="onDrop(event, '${p.id}')">
        <div class="tree-item-row" onclick="selectProject('${p.id}')">
          <span class="drag-handle" onmousedown="event.stopPropagation()">⠿</span>
          ${hasChildren ? `<span class="tree-toggle ${isExpanded ? 'expanded' : ''}" onclick="event.stopPropagation(); toggleTreeNode('${p.id}', this)">▶</span>` : '<span class="tree-toggle-spacer"></span>'}
          <span class="project-icon">${hasChildren ? '📁' : '📂'}</span>
          <span class="tree-name">${escapeHtml(p.name)}${p.visibility === 'private' ? ' 🔒' : ''}</span>
          <span class="report-count">${p.totalReportCount}</span>
          ${depth < 2 ? `<button class="btn-add-child" onclick="event.stopPropagation(); openNewProjectModal('${p.id}')" title="하위 폴더 추가">+</button>` : ''}
        </div>
      </li>
    `;

    if (hasChildren) {
      const display = isExpanded ? 'block' : 'none';
      html += `<ul class="tree-children" id="children-${p.id}" style="display:${display}">${renderTreeNodes(p.children, depth + 1)}</ul>`;
    }

    return html;
  }).join('');
}

function isAncestorOfCurrent(node) {
  if (!currentProjectId) return false;
  if (node.id === currentProjectId) return true;
  if (node.children) {
    return node.children.some(child => isAncestorOfCurrent(child));
  }
  return false;
}

function toggleTreeNode(id, el) {
  const childrenEl = document.getElementById(`children-${id}`);
  if (!childrenEl) return;

  const isVisible = childrenEl.style.display !== 'none';
  childrenEl.style.display = isVisible ? 'none' : 'block';
  el.classList.toggle('expanded', !isVisible);
}

function renderDashboard() {
  const stats = document.getElementById('dashboardStats');
  const allProjects = flattenTree(projectTree);
  const totalReports = allProjects.reduce((sum, p) => sum + p.reportCount, 0);

  stats.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${allProjects.length}</div>
      <div class="stat-label">프로젝트</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalReports}</div>
      <div class="stat-label">전체 리포트</div>
    </div>
  `;

  const recent = document.getElementById('recentReports');
  const recentProjects = allProjects
    .filter(p => p.latestDate)
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate))
    .slice(0, 5);

  if (recentProjects.length === 0) {
    recent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>아직 리포트가 없습니다</h3>
        <p>프로젝트를 만들고 HTML 리포트를 업로드하세요.</p>
      </div>
    `;
    return;
  }

  recent.innerHTML = recentProjects.map(p => `
    <div class="recent-item" onclick="selectProject('${p.id}')">
      <span class="ri-icon">📂</span>
      <span class="ri-name">${escapeHtml(p.name)}</span>
      <span class="ri-date">${p.latestDate} · ${p.reportCount}건</span>
    </div>
  `).join('');
}

function selectProject(id) {
  navigateTo(`#project/${id}`);
}

async function showProjectView(id) {
  showView('projectView');

  const project = findProjectInTree(projectTree, id);
  if (project) {
    const breadcrumb = getProjectBreadcrumb(id);
    document.getElementById('projectTitle').innerHTML = `
      <span class="editable-title" ondblclick="startEditProjectName('${id}', this)">${escapeHtml(project.name)}</span>
      <button class="btn-edit-name" onclick="startEditProjectName('${id}', this.previousElementSibling)" title="이름 수정">✏️</button>
    `;
    document.getElementById('projectBreadcrumb').innerHTML = breadcrumb
      .map((b, i) => i < breadcrumb.length - 1
        ? `<span class="breadcrumb-item" onclick="selectProject('${b.id}')">${escapeHtml(b.name)}</span><span class="breadcrumb-sep">/</span>`
        : `<span class="breadcrumb-current">${escapeHtml(b.name)}</span>`
      ).join('');
  }

  // 유형 분기 (§4): 결과형 = 취합 대시보드, 문서형 = 리포트 목록(현행)
  const isResult = project && project.type === 'result';
  // 결과형은 업로드 진입점 단일화(§8 위저드) — 문서형만 리포트 업로드 노출
  document.getElementById('btnUploadReport').style.display = isResult ? 'none' : '';
  document.getElementById('btnUploadSource').style.display = isResult ? '' : 'none';
  document.getElementById('btnRefreshConsolidated').style.display = isResult ? '' : 'none';
  document.getElementById('dateGroups').style.display = isResult ? 'none' : '';
  document.getElementById('consolidatedView').style.display = isResult ? '' : 'none';

  if (isResult) {
    await renderConsolidated(id);
  } else {
    const grouped = await api(`/api/projects/${id}/reports`);
    renderDateGroups(grouped);
    renderConvertBanner(grouped);
  }
}

// 문서형 프로젝트에 Playwright 리포트가 있으면 결과형 전환 제안 배너 표시
function renderConvertBanner(grouped) {
  const all = Object.values(grouped || {}).flat();
  if (!all.some(r => r.playwright)) return;
  document.getElementById('dateGroups').insertAdjacentHTML('afterbegin', `
    <div class="pw-convert-banner">
      <div class="pw-convert-text">🤖 <b>Playwright 리포트가 감지되었습니다.</b><br>
        결과형으로 전환하면 업로드된 리포트가 취합 소스로 자동 등록되고, TC ID 기준 취합 대시보드(통계·거래소축·Fail 인사이트·AI 분석)를 볼 수 있어요.</div>
      <button class="btn btn-primary" onclick="convertToResult()">결과형으로 전환하기</button>
    </div>`);
}

async function convertToResult() {
  if (!currentProjectId) return;
  const msg = '이 프로젝트를 결과형으로 전환할까요?\n\n'
    + '· Playwright 리포트 → 취합 소스로 자동 등록 (재업로드 불필요)\n'
    + '· 그 외 문서형 리포트(HTML/Sheets/다이어그램)는 결과형 화면에서 표시되지 않습니다 (데이터는 보존)\n'
    + '· 전환 후 문서형으로 되돌리기는 지원되지 않습니다';
  if (!confirm(msg)) return;

  showLoadingOverlay('결과형으로 전환하고 있습니다...');
  const d = await api(`/api/projects/${currentProjectId}/convert-to-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  hideLoadingOverlay();
  if (!d || d.error) { showToast('❌ ' + ((d && d.error) || '전환 실패'), 'error'); return; }

  const rows = (d.sources || []).reduce((a, s) => a + (s.rowCount || 0), 0);
  showToast(`✅ 결과형 전환 완료 — 소스 ${(d.sources || []).length}개 · ${rows}행 취합`, 'success');
  (d.skipped || []).forEach(s => showToast(`⚠️ ${s.file}: ${s.reason}`, 'error'));
  await loadProjects();
  showProjectView(currentProjectId);
}

// ===== 결과 취합 대시보드 (결과형 프로젝트) =====
let consolidatedData = null;
let consolidatedFilter = 'all';
let consSelected = new Set();      // Jira 내보내기 체크 상태 — key: `${tcId}|${exchange||''}`
let consVisibleFailKeys = [];      // 현재 필터로 보이는 Fail 행 key (전체 선택/해제 대상)

// 대시보드 구성: 스펙 §9.3 (2026-07-21 개정) ① 요약 밴드 → ② 축별 분포 → ③ Fail 사유 패턴
// → ④ 소스 파일(접힘) → ⑤ pivot 표(스크롤) → ⑥ AI(Fail 분석 + Q&A).
// 기존 단건 대시보드의 dash-*/detail-*/ai-* 문법 재사용. 필터 클릭은 축·칩·표만 부분 렌더
// (전체 재렌더 시 AI 대화가 초기화되므로).
let consAxisFilter = null;   // { key: 'exchange'|'suite'|'source', value }
let consReasonFilter = null; // failReasons 인덱스
let consSearchQ = '';
let consProjectId = null;

async function renderConsolidated(id) {
  const container = document.getElementById('consolidatedView');
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>취합 계산 중…</p></div>';
  const data = await api(`/api/projects/${id}/consolidated`);
  if (data.error) { container.innerHTML = `<div class="empty-state"><p>${escapeHtml(data.error)}</p></div>`; return; }
  consolidatedData = data;
  consProjectId = id;
  consolidatedFilter = 'all'; consAxisFilter = null; consReasonFilter = null; consSearchQ = '';
  consSelected.clear(); // Jira 내보내기 선택은 프로젝트/데이터 갱신 시 초기화
  Object.keys(consDetailCache).forEach(k => delete consDetailCache[k]); // 데이터 갱신 시 상세 캐시 무효화

  if (!data.sourceFiles || data.sourceFiles.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <h3>취합할 결과 소스가 없습니다</h3>
        <p>Playwright 리포트 ZIP을 업로드하면 TC ID 기준으로 취합됩니다.</p>
        <button class="btn btn-primary" onclick="openSourceModal()">📊 결과 소스 업로드</button>
      </div>`;
    return;
  }
  renderConsolidatedBody();
}

function renderConsolidatedBody() {
  const container = document.getElementById('consolidatedView');
  const data = consolidatedData;
  const s = data.stats;
  const multi = data.sources.length >= 2; // 불일치·커버리지는 소스 2종 이상일 때만 의미 있음

  // ① 요약 밴드 — Pass Rate·실행률 게이지 + 카운트 (모수: 전체 = 실행(P+F) + N/T)
  const execRate = s.totalTc ? Math.round((s.executed / s.totalTc) * 100) : 0;
  const rateColor = s.passRate >= 90 ? '#22c55e' : s.passRate >= 70 ? '#f59e0b' : '#ef4444';
  const execColor = execRate >= 80 ? '#22c55e' : execRate >= 50 ? '#f59e0b' : '#6b7280';
  const covPairs = Object.entries(s.coverage || {});
  const summary = `
    <div class="dash-panel cons-summary">
      <div class="dash-summary">
        <div class="dash-rate">
          <div class="dash-rate-circle" style="--rate:${s.passRate}; --color:${rateColor}"><span class="dash-rate-value">${s.passRate}%</span></div>
          <div class="dash-rate-label">Pass Rate (${s.byFinal.Pass}/${s.executed})</div>
        </div>
        <div class="dash-rate">
          <div class="dash-rate-circle" style="--rate:${execRate}; --color:${execColor}"><span class="dash-rate-value">${execRate}%</span></div>
          <div class="dash-rate-label">실행률 (${s.executed}/${s.totalTc})</div>
        </div>
        <div class="dash-counts">
          <div class="dash-count pass"><span class="dash-count-value">${s.byFinal.Pass}</span><span class="dash-count-label">Pass</span></div>
          <div class="dash-count fail"><span class="dash-count-value">${s.byFinal.Fail}</span><span class="dash-count-label">Fail</span></div>
          <div class="dash-count skip"><span class="dash-count-value">${s.byFinal['N/T']}</span><span class="dash-count-label">N/T</span></div>
          ${s.byFinal.Blocked ? `<div class="dash-count na"><span class="dash-count-value">${s.byFinal.Blocked}</span><span class="dash-count-label">Blocked</span></div>` : ''}
          <div class="dash-count total" title="Pass + Fail + N/T (N/A 는 모수 제외) — 거래소별 행 기준"><span class="dash-count-value">${s.totalTc}</span><span class="dash-count-label">전체 TC</span></div>
          ${s.uniqueTc ? `<div class="dash-count" title="거래소 중복 없는 TC ID 수 (N/A 포함) — 세트 규모"><span class="dash-count-value">${s.uniqueTc}</span><span class="dash-count-label">유니크 TC</span></div>` : ''}
          ${s.byFinal['N/A'] ? `<div class="dash-count na" title="테스트 범위 밖(미개발·불필요 판정) — 지표 계산에서 제외"><span class="dash-count-value">${s.byFinal['N/A']}</span><span class="dash-count-label">범위 제외 N/A</span></div>` : ''}
          ${multi ? `<div class="dash-count ${s.mismatch ? 'fail' : ''}" title="소스 간 결과 불일치"><span class="dash-count-value">${s.mismatch}</span><span class="dash-count-label">불일치</span></div>` : ''}
          ${multi ? covPairs.map(([src, v]) => `<div class="dash-count"><span class="dash-count-value">${v}%</span><span class="dash-count-label">${escapeHtml(src)} 커버리지</span></div>`).join('') : ''}
        </div>
      </div>
    </div>`;

  // ④ 소스 파일 — 접힌 요약 한 줄, 펼치면 관리 목록
  const files = data.sourceFiles;
  const lastImported = files.reduce((m, f) => (f.importedAt > m ? f.importedAt : m), '');
  const roles = [...new Set(files.map(f => f.sourceRole))].join(' · ');
  const sourcesSection = `
    <div class="cons-sources">
      <button type="button" class="cons-sources-head" onclick="toggleConsSources()">
        <span>소스 파일 ${files.length}개 · ${escapeHtml(roles)}${lastImported ? ` · 마지막 취합 ${formatTime(lastImported)}` : ''}</span>
        <span class="fail-caret" id="consSourcesCaret">▸ 펼쳐보기</span>
      </button>
      <div class="cons-sources-body hidden" id="consSourcesBody">
        ${files.map(f => `
          <div class="cons-source-item">
            <span class="src-badge src-${escapeAttr(f.sourceRole)}">${escapeHtml(f.sourceRole)}</span>
            <span class="src-name">${escapeHtml(f.filename)}</span>
            ${f.exchange ? `<span class="src-exch">${escapeHtml(f.exchange)}</span>` : ''}
            <span class="src-meta">${f.rowCount} TC · ${f.snapshot ? escapeHtml(f.snapshot) + ' · ' : ''}${formatTime(f.importedAt)}</span>
            ${f.folderId ? `<button class="btn-icon-sm" title="원본 리포트 열기" onclick="openReportDirect('/uploads/${escapeAttr(f.indexPath)}')">↗</button>` : ''}
            <button class="btn-icon-sm danger" title="소스 삭제" onclick="deleteSource('${f.id}')">🗑</button>
          </div>`).join('')}
      </div>
    </div>`;

  // ⑥ AI — Fail 분석(자동) + Q&A. 기존 ai-*/fail-analysis 컴포넌트를 cons-<projectId> id로 재사용.
  const aiOn = typeof QA_CONFIG !== 'undefined' && QA_CONFIG && QA_CONFIG.aiEnabled;
  const aiId = 'cons-' + consProjectId;
  const aiSection = aiOn ? `
    <div class="dash-panel cons-ai">
      ${s.byFinal.Fail > 0 ? `<div class="dash-section fail-analysis" id="fail-analysis-${aiId}"></div>` : ''}
      ${renderAiSection(aiId)}
    </div>` : '';

  // 축/사유/필터/표는 부분 렌더 대상 — 컨테이너만 만들어 두고 아래에서 채움
  container.innerHTML = summary
    + '<div id="consAxesBox"></div><div id="consPinnedBox"></div><div id="consReasonsBox"></div>'
    + sourcesSection
    + '<div id="consFiltersBox"></div><div class="cons-table-wrap" id="consTableWrap"></div>'
    + aiSection;
  renderConsAxes();
  renderConsPinned();
  renderConsFilters();
  renderConsTable();
  if (aiOn && s.byFinal.Fail > 0) loadFailAnalysis(aiId);
}

// ②③ 축별 분포 + Fail 사유 패턴 — 필터 상태(active) 반영을 위해 부분 렌더
function renderConsAxes() {
  const data = consolidatedData;
  const axesBox = document.getElementById('consAxesBox');
  const reasonsBox = document.getElementById('consReasonsBox');
  if (!axesBox || !reasonsBox) return;

  const axesGroups = (data.axes || []).map(ax => {
    const rows = ax.values.map(v => consStackRow(ax.key, v, ax.filterable !== false)).join('');
    return rows ? `<div class="detail-group"><div class="dash-section-title">${escapeHtml(ax.name)}</div>${rows}</div>` : '';
  }).join('');
  axesBox.innerHTML = axesGroups ? `
    <div class="dash-panel cons-axes">
      <div class="detail-legend">
        <span class="legend-item"><i class="legend-dot seg-pass"></i>Pass</span>
        <span class="legend-item"><i class="legend-dot seg-fail"></i>Fail</span>
        <span class="legend-item"><i class="legend-dot seg-nt"></i>N/T</span>
        <span class="legend-item"><i class="legend-dot seg-na"></i>결과 없음</span>
      </div>
      ${axesGroups}
    </div>` : '';

  const reasons = data.failReasons || [];
  const maxReason = reasons.length ? reasons[0].count : 1;
  reasonsBox.innerHTML = reasons.length ? `
    <div class="dash-panel cons-reasons">
      <div class="dash-section-title">❌ Fail 사유 패턴 (상위 ${reasons.length})</div>
      ${reasons.map((g, i) => `
        <div class="detail-row cons-click-row ${consReasonFilter === i ? 'active' : ''}" onclick="setConsReasonFilter(${i})" title="클릭하면 해당 TC만 아래 표에 표시">
          <span class="detail-row-label cons-reason-label" title="${escapeAttr(g.pattern)}">${escapeHtml(g.pattern)}</span>
          <div class="detail-stack"><div class="stack-seg seg-fail" style="width:${((g.count / maxReason) * 100).toFixed(1)}%"></div></div>
          <span class="detail-row-counts">${g.count}건</span>
        </div>`).join('')}
    </div>` : '';
}

// ⑤ 필터 버튼 + 검색 + 해제 칩 — 부분 렌더
function renderConsFilters() {
  const box = document.getElementById('consFiltersBox');
  if (!box) return;
  const data = consolidatedData;
  const multi = data.sources.length >= 2;
  const reasons = data.failReasons || [];
  const chips = [];
  if (consAxisFilter) chips.push(`<span class="cons-chip" onclick="setConsAxisFilter('${escapeAttr(consAxisFilter.key)}','${escapeAttr(consAxisFilter.value)}')" title="필터 해제">${escapeHtml(consAxisFilter.value)} ✕</span>`);
  if (consReasonFilter !== null && reasons[consReasonFilter]) chips.push(`<span class="cons-chip" onclick="setConsReasonFilter(${consReasonFilter})" title="필터 해제">${escapeHtml(reasons[consReasonFilter].pattern)} ✕</span>`);
  const filterKeys = multi ? [['all','전체'],['fail','Fail'],['mismatch','불일치'],['nt','N/T']] : [['all','전체'],['fail','Fail'],['nt','N/T']];
  if (data.stats && data.stats.byFinal && data.stats.byFinal['N/A']) filterKeys.push(['na', 'N/A']);
  box.innerHTML = `
    <div class="cons-filters">
      ${filterKeys.map(([k,label]) =>
        `<button class="cons-filter ${consolidatedFilter===k?'active':''}" onclick="setConsFilter('${k}')">${label}</button>`).join('')}
      <input type="text" class="cons-search" id="consSearch" placeholder="TC ID 검색…" value="${escapeAttr(consSearchQ)}" oninput="consSearchQ=this.value; renderConsTable()">
      ${chips.join('')}
      <span class="jira-export-box">
        <button class="btn btn-sm" id="jiraXlsxBtn" disabled onclick="jiraExportRun('xlsx')" title="체크한 Fail 항목을 Jira 등록용 XLSX 로 다운로드">📤 Jira XLSX</button>
        <button class="btn btn-sm" id="jiraSheetBtn" disabled onclick="jiraExportRun('gsheet')" title="체크한 Fail 항목으로 Google Spreadsheet 생성">📤 Jira Sheets</button>
        <span id="jiraSelCount" class="jira-sel-count"></span>
      </span>
      ${data.untagged.count ? `<span class="cons-untagged" title="TC ID 없는 테스트(setup/teardown/미태그) — 클릭하면 목록" onclick="showUntaggedModal()">미태그 ${data.untagged.count}건</span>` : ''}
    </div>`;
  updateJiraSelCount();
}

// 축별 분포 스택 바 한 줄 (기존 renderStackRow와 동일 문법 + 클릭 필터)
function consStackRow(axKey, v, filterable = true) {
  const denom = v.total + (v.na || 0);
  if (!denom) return '';
  const seg = (n, cls, title) => n ? `<div class="stack-seg ${cls}" style="width:${((n / denom) * 100).toFixed(1)}%" title="${title} ${n}건"></div>` : '';
  const counts = [
    v.pass ? `P ${v.pass}` : '',
    v.fail ? `F ${v.fail}` : '',
    v.nt ? `N/T ${v.nt}` : '',
    v.na ? `없음 ${v.na}` : '',
  ].filter(Boolean).join(' · ');
  const active = consAxisFilter && consAxisFilter.key === axKey && consAxisFilter.value === v.value;
  const clickable = filterable && !/^기타 \(/.test(String(v.value)); // 환경축·'기타' 합산 행은 필터 불가
  return `
    <div class="detail-row ${clickable ? 'cons-click-row' : ''} ${active ? 'active' : ''}"
         ${clickable ? `onclick="setConsAxisFilter('${escapeAttr(axKey)}','${escapeAttr(v.value)}')" title="클릭하면 아래 표를 필터링합니다"` : ''}>
      <span class="detail-row-label" title="${escapeAttr(v.value)}">${escapeHtml(v.value)}</span>
      <div class="detail-stack">${seg(v.pass,'seg-pass','Pass')}${seg(v.fail,'seg-fail','Fail')}${seg(v.nt,'seg-nt','N/T')}${seg(v.na,'seg-na','결과 없음')}</div>
      <span class="detail-row-counts">${counts}</span>
    </div>`;
}

function setConsFilter(k) {
  consolidatedFilter = k;
  // 사유 칩과 상태 필터의 AND 교집합이 0행이 되는 혼란 방지 — 상태 전환 시 사유 필터 해제
  if (consReasonFilter !== null) { consReasonFilter = null; renderConsAxes(); }
  renderConsFilters();
  renderConsTable();
}

function setConsAxisFilter(key, value) {
  consAxisFilter = (consAxisFilter && consAxisFilter.key === key && consAxisFilter.value === value) ? null : { key, value };
  renderConsAxes(); renderConsFilters(); renderConsTable();
}

function setConsReasonFilter(i) {
  consReasonFilter = consReasonFilter === i ? null : i;
  renderConsAxes(); renderConsFilters(); renderConsTable();
}

function toggleConsSources() {
  const body = document.getElementById('consSourcesBody');
  const caret = document.getElementById('consSourcesCaret');
  if (!body) return;
  body.classList.toggle('hidden');
  if (caret) caret.textContent = body.classList.contains('hidden') ? '▸ 펼쳐보기' : '▾ 접기';
}

function renderConsTable() {
  if (!consolidatedData) return;
  applyTitleWidth(); // 저장된 제목 컬럼 폭 복원
  const wrap = document.getElementById('consTableWrap');
  const q = (document.getElementById('consSearch')?.value || '').trim().toUpperCase();
  const sources = consolidatedData.sources;
  let rows = consolidatedData.rows;
  if (consolidatedFilter === 'fail') rows = rows.filter(r => r.final === 'Fail');
  else if (consolidatedFilter === 'mismatch') rows = rows.filter(r => r.mismatch);
  else if (consolidatedFilter === 'nt') rows = rows.filter(r => r.final === 'N/T');
  else if (consolidatedFilter === 'na') rows = rows.filter(r => r.final === 'N/A');
  if (consAxisFilter) {
    const { key, value } = consAxisFilter;
    if (key === 'exchange') rows = rows.filter(r => r.exchange === value);
    else if (key === 'suite') rows = rows.filter(r => r.suite === value);
    else if (key === 'source') rows = rows.filter(r => r.sources[value]);
  }
  if (consReasonFilter !== null && consolidatedData.failReasons && consolidatedData.failReasons[consReasonFilter]) {
    const keys = new Set(consolidatedData.failReasons[consReasonFilter].keys);
    rows = rows.filter(r => keys.has(`${r.tcId} ${r.exchange || ''}`));
  }
  if (q) rows = rows.filter(r => r.tcId.toUpperCase().includes(q));

  const hasExch = consolidatedData.rows.some(r => r.exchange);
  const badge = (v) => `<span class="res-badge res-${v.replace('/','')}">${v}</span>`;
  // 매뉴얼 셀은 환경×테스터 원본(D3 보존)을 툴팁으로 노출
  const cellHtml = (cell) => {
    if (!cell) return '<span class="res-empty">–</span>';
    const tip = (cell.envResults || []).map(e => `${e.env}: ${e.result}`).join('\n');
    return `<span ${tip ? `title="${escapeAttr(tip)}"` : ''}>${badge(cell.result)}</span>`
      + (cell.flaky ? ' <span class="flaky" title="flaky">⚡</span>' : '');
  };
  const capped = rows.slice(0, 1000);

  consVisibleFailKeys = capped.filter(r => r.final === 'Fail').map(r => `${r.tcId}|${r.exchange || ''}`);
  // 헤더 체크박스 상태 반영 — 안 하면 재렌더마다 '해제'로 그려져 토글(전체 해제)이 불가능해진다
  const allSelected = consVisibleFailKeys.length > 0 && consVisibleFailKeys.every(k => consSelected.has(k));
  const selCell = (r) => {
    if (r.final !== 'Fail') return '<td class="td-sel"></td>';
    const key = `${r.tcId}|${r.exchange || ''}`;
    return `<td class="td-sel" onclick="event.stopPropagation()">
      <input type="checkbox" ${consSelected.has(key) ? 'checked' : ''} onchange="toggleConsSelect('${escapeAttr(key)}', this.checked)" title="Jira 내보내기 대상 선택"></td>`;
  };

  wrap.innerHTML = `
    <div class="cons-count">${rows.length ? `${rows.length}행${rows.length > capped.length ? ` (상위 ${capped.length}만 표시)` : ''}` : '조건에 맞는 행이 없습니다 — 상태 필터·사유 칩·검색어 조합을 확인하세요'}</div>
    <table class="cons-table">
      <thead><tr>
        <th class="th-sel"><input type="checkbox" ${allSelected ? 'checked' : ''} onclick="toggleConsSelectAll(this.checked)" title="보이는 Fail 전체 선택/해제"></th>
        <th>TC ID</th><th class="th-title">제목<span class="th-resize" onmousedown="startTitleResize(event)" title="드래그로 폭 조절"></span></th>${hasExch ? '<th>거래소</th>' : ''}
        ${sources.map(s => `<th>${escapeHtml(s)}</th>`).join('')}
        <th>최종</th><th>사유</th>
      </tr></thead>
      <tbody>
        ${capped.map(r => `
          <tr class="cons-row ${r.mismatch ? 'row-mismatch' : ''}" data-tc="${escapeAttr(r.tcId)}" data-ex="${escapeAttr(r.exchange || '')}"
              onclick="toggleConsDetail(this)" title="클릭하면 상세(스크린샷·영상)를 펼칩니다">
            ${selCell(r)}
            <td class="tc-id">${escapeHtml(r.tcId)}</td>
            ${titleCell(r)}
            ${hasExch ? `<td>${escapeHtml(r.exchange || '')}</td>` : ''}
            ${sources.map(s => `<td>${cellHtml(r.sources[s])}</td>`).join('')}
            <td>${badge(r.final)}${r.mismatch ? ' <span class="mismatch-tag" title="소스 간 결과 불일치">⚠</span>' : ''}</td>
            ${reasonCell(r)}
          </tr>`).join('')}
      </tbody>
    </table>`;
  wrap.dataset.cols = 5 + (hasExch ? 1 : 0) + sources.length; // 확장 패널 colspan (선택+제목 포함)
}

// ── 행 확장 패널 — TC 상세(스크린샷 썸네일·사유·영상/트레이스 딥링크) lazy 조회 ──
const consDetailCache = {};

async function toggleConsDetail(tr) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('cons-detail-tr')) { next.remove(); tr.classList.remove('expanded'); return; }
  document.querySelectorAll('.cons-detail-tr').forEach(el => {
    el.previousElementSibling?.classList.remove('expanded');
    el.remove(); // 한 번에 하나만 펼침
  });

  const tcId = tr.dataset.tc, ex = tr.dataset.ex;
  const cols = document.getElementById('consTableWrap')?.dataset.cols || 5;
  const detailTr = document.createElement('tr');
  detailTr.className = 'cons-detail-tr';
  detailTr.innerHTML = `<td colspan="${cols}"><div class="tcd-panel">불러오는 중…</div></td>`;
  tr.after(detailTr);
  tr.classList.add('expanded');

  const key = `${tcId}|${ex}`;
  if (!consDetailCache[key]) {
    consDetailCache[key] = await api(`/api/projects/${consProjectId}/tc-detail?tcId=${encodeURIComponent(tcId)}&exchange=${encodeURIComponent(ex)}`);
  }
  const d = consDetailCache[key];
  const panel = detailTr.querySelector('.tcd-panel');
  if (!d || d.error || !(d.records || []).length) { panel.textContent = (d && d.error) || '상세 정보가 없습니다.'; return; }

  // 표 행과 중복되는 정보(거래소·단일 레코드의 소스/결과 태그·자연어 사유)는 표시하지 않는다
  // — 자연어 사유는 표의 사유 컬럼으로 이동(2026-07-23 합의). 소스/결과 태그는 레코드가
  // 2개 이상(자동화+매뉴얼 병존 등)일 때만 구분용으로 유지.
  const multi = d.records.length > 1;
  panel.innerHTML = d.records.map(rec => {
    const envChips = (rec.envResults || []).map(e =>
      `<span class="tcd-env">${escapeHtml(e.env)}: <b>${escapeHtml(e.result)}</b></span>`).join('');
    const imgs = (rec.images || []).map((u, i) =>
      `<img class="tcd-thumb" src="${escapeAttr(u)}" loading="lazy" title="클릭하면 확대 (휠 줌·드래그 이동)"
         onclick='openLightbox(${JSON.stringify(rec.images)}, ${i})'>`).join('');
    return `
      <div class="tcd-item">
        <div class="tcd-head">
          ${multi ? `<span class="src-badge src-${escapeAttr(rec.source)}">${escapeHtml(rec.source)}</span>
          <span class="res-badge res-${String(rec.result).replace('/', '')}">${escapeHtml(rec.result)}</span>` : ''}
          ${rec.env ? `<span class="src-meta">${escapeHtml(rec.env)}</span>` : ''}
          ${rec.flaky ? '<span class="flaky" title="flaky">⚡</span>' : ''}
          ${rec.title ? `<span class="tcd-title" title="${escapeAttr(rec.title)}">${escapeHtml(rec.title)}</span>` : ''}
          ${rec.deepLink ? `<a class="btn btn-sm tcd-deep" href="${escapeAttr(rec.deepLink)}" target="_blank" onclick="event.stopPropagation()">🎬 영상·트레이스 보기 →</a>` : ''}
        </div>
        ${(rec.errorDetail || rec.reason) ? `<details class="tcd-raw"><summary>원본 에러 메시지 보기</summary><pre>${escapeHtml(rec.errorDetail || rec.reason)}</pre></details>` : ''}
        ${envChips ? `<div class="tcd-envs">${envChips}</div>` : ''}
        ${imgs ? `<div class="tcd-thumbs">${imgs}</div>` : ''}
      </div>`;
  }).join('');
}

// ── 줌·팬 라이트박스 — 휠 줌(커서 기준)·드래그 이동·←/→ 넘기기·ESC 닫기 ──
let lb = null; // { images, idx, scale, tx, ty, dragging, sx, sy }

function openLightbox(images, idx) {
  event?.stopPropagation();
  lb = { images, idx: idx || 0, scale: 1, tx: 0, ty: 0, dragging: false };
  let el = document.getElementById('lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lightbox';
    el.innerHTML = `
      <div class="lb-toolbar">
        <span class="lb-count" id="lbCount"></span>
        <a class="btn btn-sm" id="lbOpenTab" target="_blank">↗ 새 탭에서 열기</a>
        <button class="btn btn-sm" onclick="closeLightbox()">✕ 닫기 (ESC)</button>
      </div>
      <button class="lb-nav lb-prev" onclick="lbNav(-1)">‹</button>
      <img id="lbImg" draggable="false">
      <button class="lb-nav lb-next" onclick="lbNav(1)">›</button>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) closeLightbox(); });
    el.addEventListener('wheel', lbWheel, { passive: false });
    const img = el.querySelector('#lbImg');
    img.addEventListener('mousedown', (e) => { lb.dragging = true; lb.sx = e.clientX - lb.tx; lb.sy = e.clientY - lb.ty; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (lb && lb.dragging) { lb.tx = e.clientX - lb.sx; lb.ty = e.clientY - lb.sy; lbApply(); } });
    window.addEventListener('mouseup', () => { if (lb) lb.dragging = false; });
    img.addEventListener('dblclick', () => { lb.scale = 1; lb.tx = 0; lb.ty = 0; lbApply(); });
  }
  el.classList.add('open');
  document.addEventListener('keydown', lbKeys);
  lbShow();
}

function lbShow() {
  const img = document.getElementById('lbImg');
  img.src = lb.images[lb.idx];
  lb.scale = 1; lb.tx = 0; lb.ty = 0;
  lbApply();
  document.getElementById('lbCount').textContent = lb.images.length > 1 ? `${lb.idx + 1} / ${lb.images.length}` : '';
  document.getElementById('lbOpenTab').href = lb.images[lb.idx];
  document.querySelectorAll('.lb-nav').forEach(b => b.style.display = lb.images.length > 1 ? '' : 'none');
}

function lbApply() {
  const img = document.getElementById('lbImg');
  if (img) img.style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.scale})`;
}

function lbWheel(e) {
  e.preventDefault();
  if (!lb) return;
  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  const next = Math.min(8, Math.max(0.2, lb.scale * factor));
  // 커서 기준 줌 — 커서가 가리키는 지점이 그대로 머물도록 이동량 보정
  const cx = e.clientX - window.innerWidth / 2;
  const cy = e.clientY - window.innerHeight / 2;
  lb.tx = cx - (cx - lb.tx) * (next / lb.scale);
  lb.ty = cy - (cy - lb.ty) * (next / lb.scale);
  lb.scale = next;
  lbApply();
}

function lbNav(d) {
  event?.stopPropagation();
  lb.idx = (lb.idx + d + lb.images.length) % lb.images.length;
  lbShow();
}

function lbKeys(e) {
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft' && lb && lb.images.length > 1) lbNav(-1);
  else if (e.key === 'ArrowRight' && lb && lb.images.length > 1) lbNav(1);
}

function closeLightbox() {
  document.getElementById('lightbox')?.classList.remove('open');
  document.removeEventListener('keydown', lbKeys);
  lb = null;
}

// ── Jira 등록용 내보내기 (docs/01-plan/features/jira-export.plan.md) ──
function toggleConsSelect(key, on) {
  if (on) consSelected.add(key); else consSelected.delete(key);
  updateJiraSelCount();
}

function toggleConsSelectAll(on) {
  consVisibleFailKeys.forEach(k => on ? consSelected.add(k) : consSelected.delete(k));
  renderConsTable();
  updateJiraSelCount();
}

function updateJiraSelCount() {
  const el = document.getElementById('jiraSelCount');
  if (el) el.textContent = consSelected.size ? `${consSelected.size}건 선택` : '';
  ['jiraXlsxBtn', 'jiraSheetBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = !consSelected.size;
  });
}

async function jiraExportRun(format) {
  if (!consSelected.size) { showToast('내보낼 Fail 항목을 먼저 체크해 주세요', 'error'); return; }
  const items = [...consSelected].map(k => {
    const i = k.lastIndexOf('|');
    return { tcId: k.slice(0, i), exchange: k.slice(i + 1) || null };
  });
  showLoadingOverlay(format === 'gsheet' ? 'Google Spreadsheet 를 생성하고 있습니다…' : 'Jira 등록용 XLSX 를 생성하고 있습니다…');
  try {
    const res = await fetch(`/api/projects/${consProjectId}/jira-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, format }),
    });
    if (format === 'xlsx' && res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `jira-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      hideLoadingOverlay();
      const skipped = JSON.parse(decodeURIComponent(res.headers.get('X-Jira-Export-Skipped') || '%5B%5D'));
      showToast(`✅ Jira 등록용 XLSX 다운로드 완료 (${items.length - skipped.length}건)`, 'success');
      skipped.forEach(s => showToast(`⚠️ ${s.tcId}: ${s.reason}`, 'error'));
      return;
    }
    const d = await res.json().catch(() => ({}));
    hideLoadingOverlay();
    if (!res.ok || d.error) {
      showToast('❌ ' + (d.error || `내보내기 실패 (${res.status})`), 'error');
      (d.skipped || []).forEach(s => showToast(`⚠️ ${s.tcId}: ${s.reason}`, 'error'));
      return;
    }
    window.open(d.url, '_blank');
    showToast('✅ Google Spreadsheet 생성 완료 — 새 탭에서 확인하세요', 'success');
    (d.skipped || []).forEach(s => showToast(`⚠️ ${s.tcId}: ${s.reason}`, 'error'));
  } catch (e) {
    hideLoadingOverlay();
    showToast('❌ 내보내기 실패: ' + e.message, 'error');
  }
}

// 미태그 목록 모달 — TC ID 태그 없는 테스트(setup/teardown/태그 누락) 열람. N/T(skipped) 우선 정렬.
function showUntaggedModal() {
  const u = consolidatedData && consolidatedData.untagged;
  if (!u || !u.count) return;
  let overlay = document.getElementById('untaggedModal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'untaggedModal';
    overlay.className = 'modal-overlay hidden';
    document.body.appendChild(overlay);
  }
  const ORDER = { 'N/T': 0, 'Fail': 1, 'Blocked': 2, 'Pass': 3, 'N/A': 4 };
  const items = [...(u.items || [])].sort((a, b) => (ORDER[a.result] ?? 9) - (ORDER[b.result] ?? 9));
  const byResult = {};
  items.forEach(it => { byResult[it.result] = (byResult[it.result] || 0) + 1; });
  const resBadge = v => `<span class="res-badge res-${String(v).replace('/', '')}">${escapeHtml(v)}</span>`;
  const summary = Object.entries(byResult).map(([res, n]) => `${resBadge(res)} ${n}건`).join(' · ');
  overlay.innerHTML = `
    <div class="modal modal-wide">
      <div class="modal-header">
        <h3>미태그 테스트 ${u.count}건</h3>
        <button class="modal-close" onclick="closeModal('untaggedModal')">✕</button>
      </div>
      <div class="modal-body">
        <p class="untagged-note">제목에 [TC ID] 태그가 없어 취합에서 제외된 테스트입니다.
          ${summary}${u.count > items.length ? ` — 상위 ${items.length}건만 표시` : ''}
          <br><small>N/T = Playwright skipped 포함. 취합에 넣으려면 테스트 제목에 [SC-…] 태그를 붙여 주세요.</small></p>
        <table class="cons-table">
          <thead><tr><th>결과</th><th>제목</th><th>파일(suite)</th><th>환경</th></tr></thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td>${resBadge(it.result)}</td>
                <td>${escapeHtml(it.title || '')}</td>
                <td>${escapeHtml(it.suite || '')}</td>
                <td>${escapeHtml(it.env || '')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  openModal('untaggedModal');
}

// 제목 컬럼 폭 드래그 조절 — 헤더 오른쪽 가장자리를 끌면 조절되고 localStorage 로 유지
function applyTitleWidth() {
  const w = parseInt(localStorage.getItem('consTitleWidth'), 10);
  if (w) document.documentElement.style.setProperty('--tc-title-w', w + 'px');
}
function startTitleResize(e) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.pageX;
  const startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tc-title-w'), 10) || 240;
  const move = ev => {
    const w = Math.min(800, Math.max(120, startW + (ev.pageX - startX)));
    document.documentElement.style.setProperty('--tc-title-w', w + 'px');
    localStorage.setItem('consTitleWidth', w);
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// 제목 셀 — 소스 셀의 titles 중 첫 번째 표시. TC ID 태그([SC-…])는 TC ID 컬럼과 중복이라
// 표시에서만 제거, 원문(전체 제목 목록)은 툴팁.
// [SC-A-001] 단일뿐 아니라 [SC-A-001 | SC-A-002](나열), [SC-A-001 ~ SC-A-012](범위) 묶음도 제거
const TC_TAG_RE = /\[\s*[A-Z]{2,5}(?:-[A-Z0-9]+)+-\d+(?:\s*[|,/~]\s*[A-Z]{2,5}(?:-[A-Z0-9]+)+-\d+)*\s*\]/g;
function titleCell(r) {
  const all = [];
  for (const s of Object.values(r.sources)) for (const t of (s.titles || [])) if (t && !all.includes(t)) all.push(t);
  if (!all.length) return '<td class="tc-title"></td>';
  const shown = all[0].replace(TC_TAG_RE, '').trim() || all[0];
  return `<td class="tc-title" title="${escapeAttr(all.join('\n'))}">${escapeHtml(shown)}${all.length > 1 ? ` <small>+${all.length - 1}</small>` : ''}</td>`;
}

// 사유 셀 — 자연어 번역문 우선 표시, 원문은 툴팁. 미지 패턴은 원문 그대로(오역 없음 원칙).
function reasonCell(r) {
  for (const s of Object.values(r.sources)) {
    if (s.humanReason || s.reason) {
      const text = s.humanReason || s.reason;
      const tip = s.humanReason && s.reason ? ` title="${escapeAttr(s.reason)}"` : '';
      return `<td class="reason"${tip}>${escapeHtml(text)}</td>`;
    }
  }
  return '<td class="reason"></td>';
}

// ===== 결과 소스 업로드 위저드 (Phase 2 — §11: ①양식 감지 → ②매핑 확인 → ③미리보기 → ④취합) =====
let wiz = null; // { step, files, gsheetUrl, preview, committed }

const WIZ_STEPS = ['파일/양식', '매핑 확인', '미리보기', '취합 실행'];

function openSourceModal() {
  wiz = { step: 1, files: [], gsheetUrl: '', preview: null, committed: false };
  renderWizard();
  openModal('sourceModal');
}

function closeSourceWizard() {
  // 미커밋 스테이징 정리 (수용기준: 취소 시 DB 무변화)
  if (wiz && wiz.preview && !wiz.committed) {
    api(`/api/consolidate/staging/${wiz.preview.stagingId}`, { method: 'DELETE' });
  }
  wiz = null;
  closeModal('sourceModal');
}

function renderWizard() {
  if (!wiz) return;
  document.getElementById('wizSteps').innerHTML = WIZ_STEPS.map((label, i) =>
    `<span class="wiz-step ${wiz.step === i + 1 ? 'active' : ''} ${wiz.step > i + 1 ? 'done' : ''}">${i + 1}. ${label}</span>`
  ).join('<span class="wiz-sep">→</span>');
  const body = document.getElementById('wizBody');
  const footer = document.getElementById('wizFooter');
  if (wiz.step === 1) { renderWizStep1(body, footer); }
  else if (wiz.step === 2) { renderWizStep2(body, footer); }
  else if (wiz.step === 3) { renderWizStep3(body, footer); }
  else { renderWizStep4(body, footer); }
}

// ① 파일/양식 — 파일 드롭(ZIP/XLSX/CSV) 또는 Google Sheets URL, 양식은 서버가 자동 감지
function renderWizStep1(body, footer) {
  body.innerHTML = `
    <div class="upload-zone" id="wizZone">
      <div class="upload-zone-content">
        <div class="upload-icon">📊</div>
        <p>결과 파일을 드래그하거나 클릭하여 선택</p>
        <span class="upload-hint">🤖 Playwright 리포트 ZIP · 📋 매뉴얼 결과 XLSX/CSV — 양식은 자동 감지됩니다</span>
      </div>
      <input type="file" id="wizFileInput" multiple accept=".zip,.xlsx,.xls,.csv" hidden>
    </div>
    <div class="upload-file-list" id="wizFileList"></div>
    <div class="form-group" style="margin-top:12px">
      <label>또는 Google Sheets URL <small>(매뉴얼 결과 시트)</small></label>
      <input type="text" id="wizGsheetUrl" class="form-input" placeholder="https://docs.google.com/spreadsheets/d/…"
        value="${escapeAttr(wiz.gsheetUrl)}" oninput="wiz.gsheetUrl=this.value.trim(); renderWizFooter1()">
    </div>`;
  footer.innerHTML = '';
  renderWizFileList();
  renderWizFooter1();
  bindWizZone();
}

function renderWizFooter1() {
  const ready = wiz.files.length > 0 || wiz.gsheetUrl;
  document.getElementById('wizFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="closeSourceWizard()">취소</button>
    <button class="btn btn-primary" onclick="runWizPreview()" ${ready ? '' : 'disabled'}>분석 →</button>`;
}

function bindWizZone() {
  const zone = document.getElementById('wizZone');
  const input = document.getElementById('wizFileInput');
  if (!zone || !input) return;
  const ACCEPT = /\.(zip|xlsx|xls|csv)$/i;
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('dragover');
    wiz.files.push(...Array.from(e.dataTransfer.files).filter(f => ACCEPT.test(f.name)));
    renderWizFileList(); renderWizFooter1();
  });
  input.addEventListener('change', () => {
    wiz.files.push(...Array.from(input.files)); input.value = '';
    renderWizFileList(); renderWizFooter1();
  });
}

function renderWizFileList() {
  const el = document.getElementById('wizFileList');
  if (!el) return;
  el.innerHTML = wiz.files.map((f, i) => `
    <div class="upload-file-item"><span>${/\.zip$/i.test(f.name) ? '🤖' : '📋'}</span>
    <span class="file-name">${escapeHtml(f.name)}</span>
    <button class="file-remove" onclick="wiz.files.splice(${i},1);renderWizFileList();renderWizFooter1()">✕</button></div>`).join('');
}

// ── 청크 업로드 — Cloudflare 요청 본문 100MB 제한 우회 ──
// 파일을 64MB 조각으로 나눠 순차 전송하면 서버가 재조립해 스테이징한다.
const UPLOAD_CHUNK_SIZE = 64 * 1024 * 1024;

async function uploadViaChunks(file, onProgress) {
  const uploadId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const total = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_SIZE));
  for (let i = 0; i < total; i++) {
    const fd = new FormData();
    fd.append('uploadId', uploadId);
    fd.append('chunkIndex', String(i));
    fd.append('chunk', file.slice(i * UPLOAD_CHUNK_SIZE, (i + 1) * UPLOAD_CHUNK_SIZE));
    let res;
    try {
      res = await fetch('/api/uploads/chunk', { method: 'POST', body: fd });
    } catch (_) {
      throw new Error(`'${file.name}' 업로드 중 연결이 끊겼습니다. 네트워크 확인 후 다시 시도해 주세요.`);
    }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `'${file.name}' 업로드 실패 (${res.status})`);
    }
    if (onProgress) onProgress(i + 1, total);
  }
  const res = await fetch('/api/uploads/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, totalChunks: total, filename: file.name }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(d.error || `'${file.name}' 업로드 마무리 실패 (${res.status})`);
  return { stagedName: d.stagedName, originalName: file.name };
}

// 여러 파일을 청크 업로드로 스테이징하며 오버레이에 진행률 표시
async function stageFilesWithProgress(files) {
  const staged = [];
  for (let n = 0; n < files.length; n++) {
    const f = files[n];
    staged.push(await uploadViaChunks(f, (done, total) => {
      const pct = Math.round((done / total) * 100);
      showLoadingOverlay(`파일 업로드 중 (${n + 1}/${files.length}) ${f.name} — ${pct}%`);
    }));
  }
  return staged;
}

async function runWizPreview() {
  if (!currentProjectId || !wiz) return;
  showLoadingOverlay('파일을 업로드하고 있습니다…');
  try {
    const staged = await stageFilesWithProgress(wiz.files);
    showLoadingOverlay('양식을 감지하고 파싱하고 있습니다…');
    const formData = new FormData();
    formData.append('stagedFiles', JSON.stringify(staged));
    if (wiz.gsheetUrl) formData.append('gsheetUrl', wiz.gsheetUrl);
    const res = await fetch(`/api/projects/${currentProjectId}/consolidate/preview`, { method: 'POST', body: formData });
    const d = await res.json();
    hideLoadingOverlay();
    if (!res.ok || d.error) {
      showToast('❌ ' + (d.error || `분석 실패 (${res.status})`), 'error');
      (d.skipped || []).forEach(s => showToast(`⚠️ ${s.file}: ${s.reason}`, 'error'));
      return;
    }
    wiz.preview = d;
    wiz.step = 2;
    renderWizard();
  } catch (e) {
    hideLoadingOverlay();
    showToast('❌ 분석 실패: ' + e.message, 'error');
  }
}

// ② 매핑 확인 — 감지된 양식·시트·컬럼 표시 (D2: 선택 UI 없음, 확인만)
function renderWizStep2(body, footer) {
  const p = wiz.preview;
  const itemHtml = p.items.map(item => {
    const isPw = item.kind === 'playwright';
    const sheets = (item.detected.sheets || []).map(s => `
      <tr class="${s.adopted ? '' : 'wiz-excluded'}">
        <td>${escapeHtml(s.name)}</td>
        <td>${s.adopted ? `✓ ${s.rowCount}행` : `배제 — ${escapeHtml(s.reason || '')}`}</td>
        <td>${s.adopted ? escapeHtml(isPw ? (s.exchange || '자동') : (s.resultLabels || []).join(', ')) : ''}</td>
      </tr>`).join('');
    return `
      <div class="wiz-item">
        <div class="wiz-item-head">
          <span class="src-badge src-${isPw ? 'automation' : 'manual'}">${isPw ? '🤖 Playwright (자동화)' : `📋 매뉴얼 (${escapeHtml(item.format)})`}</span>
          <span class="file-name">${escapeHtml(item.filename)}</span>
          <span class="src-meta">${item.detected.rowCount}건 인식</span>
        </div>
        <table class="wiz-table">
          <thead><tr><th>${isPw ? '리포트 폴더' : '시트'}</th><th>인식</th><th>${isPw ? '거래소' : '결과 컬럼 (환경×테스터)'}</th></tr></thead>
          <tbody>${sheets}</tbody>
        </table>
      </div>`;
  }).join('');
  body.innerHTML = itemHtml + ((wiz.preview.skipped || []).length
    ? `<div class="wiz-warn">⚠️ 제외: ${wiz.preview.skipped.map(s => `${escapeHtml(s.file)} (${escapeHtml(s.reason)})`).join(' · ')}</div>` : '');
  footer.innerHTML = `
    <button class="btn btn-secondary" onclick="wizBackToInput()">← 다시 선택</button>
    <button class="btn btn-primary" onclick="wiz.step=3;renderWizard()">다음 →</button>`;
}

function wizBackToInput() {
  if (wiz.preview) api(`/api/consolidate/staging/${wiz.preview.stagingId}`, { method: 'DELETE' });
  wiz.preview = null;
  wiz.step = 1;
  renderWizard();
}

// ③ 미리보기 — 기존 TC 매칭·신규·예상 불일치 + 프리픽스(플랫폼) 경고 + 샘플
function renderWizStep3(body, footer) {
  const p = wiz.preview;
  const m = p.matchPreview || {};
  const warns = (p.warnings || []).map(w => `<div class="wiz-warn">⚠️ ${escapeHtml(w)}</div>`).join('');
  const sample = (p.sample || []).map(r => `
    <tr><td class="tc-id">${escapeHtml(r.tcId)}</td>
      <td><span class="res-badge res-${String(r.result).replace('/', '')}">${escapeHtml(r.result)}</span></td>
      <td>${escapeHtml(r.exchange || r.sheet || '')}</td>
      <td>${(r.envResults || []).map(e => `${escapeHtml(e.env)}: ${escapeHtml(e.result)}`).join(' · ')}</td></tr>`).join('');
  body.innerHTML = `
    <div class="dash-counts wiz-match">
      <div class="dash-count"><span class="dash-count-value">${m.existingTcCount || 0}</span><span class="dash-count-label">기존 TC</span></div>
      <div class="dash-count pass"><span class="dash-count-value">${m.matched || 0}</span><span class="dash-count-label">매칭</span></div>
      <div class="dash-count"><span class="dash-count-value">${m.newTc || 0}</span><span class="dash-count-label">신규 TC</span></div>
      <div class="dash-count ${m.expectedMismatch ? 'fail' : ''}"><span class="dash-count-value">${m.expectedMismatch || 0}</span><span class="dash-count-label">예상 불일치</span></div>
    </div>
    ${warns}
    <div class="dash-section-title" style="margin-top:12px">샘플 (상위 ${(p.sample || []).length}건)</div>
    <table class="wiz-table">
      <thead><tr><th>TC ID</th><th>대표값</th><th>거래소/시트</th><th>환경별</th></tr></thead>
      <tbody>${sample}</tbody>
    </table>`;
  footer.innerHTML = `
    <button class="btn btn-secondary" onclick="wiz.step=2;renderWizard()">← 이전</button>
    <button class="btn btn-primary" onclick="wiz.step=4;renderWizard()">다음 →</button>`;
}

// ④ 취합 실행 — 스냅샷 입력 후 commit
function renderWizStep4(body, footer) {
  body.innerHTML = `
    <div class="form-group">
      <label>스냅샷/버전 <small>(선택 — 소스 목록에 표시됩니다)</small></label>
      <input type="text" id="wizSnapshot" class="form-input" placeholder="예: 260721, v3.1">
    </div>
    <p class="form-hint">취합 실행 시 ${wiz.preview.items.length}개 입력이 소스로 등록되고 대시보드에 즉시 반영됩니다.</p>`;
  footer.innerHTML = `
    <button class="btn btn-secondary" onclick="wiz.step=3;renderWizard()">← 이전</button>
    <button class="btn btn-primary" id="wizCommitBtn" onclick="runWizCommit()">취합 실행</button>`;
}

async function runWizCommit() {
  if (!wiz || !wiz.preview) return;
  const btn = document.getElementById('wizCommitBtn');
  if (btn) btn.disabled = true;
  showLoadingOverlay('취합을 반영하고 있습니다…');
  const d = await api(`/api/projects/${currentProjectId}/consolidate/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stagingId: wiz.preview.stagingId,
      snapshot: (document.getElementById('wizSnapshot')?.value || '').trim(),
      uploadedBy: (localStorage.getItem('uploaderName') || '').trim() || undefined,
    }),
  });
  hideLoadingOverlay();
  if (!d || d.error) {
    if (btn) btn.disabled = false;
    showToast('❌ ' + ((d && d.error) || '취합 실패'), 'error');
    return;
  }
  wiz.committed = true;
  const rows = (d.sources || []).reduce((a, s) => a + (s.rowCount || 0), 0);
  showToast(`✅ 취합 완료 — 소스 ${(d.sources || []).length}개 · ${rows}행 반영`, 'success');
  (d.skipped || []).forEach(s => showToast(`⚠️ ${s.file}: ${s.reason}`, 'error'));
  closeSourceWizard();
  await loadProjects();
  renderConsolidated(currentProjectId);
}

async function deleteSource(id) {
  if (!confirm('이 소스와 취합된 결과를 삭제하시겠습니까?')) return;
  const res = await api(`/api/sources/${id}`, { method: 'DELETE' });
  if (res.error) { showToast('❌ ' + res.error, 'error'); return; }
  showToast('✅ 소스 삭제됨', 'success');
  await loadProjects();
  renderConsolidated(currentProjectId);
}

function startEditProjectName(projectId, el) {
  const project = findProjectInTree(projectTree, projectId);
  if (!project) return;

  const titleContainer = document.getElementById('projectTitle');
  const currentName = project.name;

  titleContainer.innerHTML = `
    <input type="text" class="edit-name-input" id="editNameInput" value="${escapeHtml(currentName)}" 
      onkeydown="handleEditNameKey(event, '${projectId}')" 
      onblur="saveProjectName('${projectId}')">
  `;

  const input = document.getElementById('editNameInput');
  input.focus();
  input.select();
}

function handleEditNameKey(e, projectId) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveProjectName(projectId);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    showProjectView(projectId); // 편집 취소, 원래로 복원
  }
}

async function saveProjectName(projectId) {
  const input = document.getElementById('editNameInput');
  if (!input) return;

  const newName = input.value.trim();
  if (!newName) {
    showProjectView(projectId);
    return;
  }

  const project = findProjectInTree(projectTree, projectId);
  if (project && newName !== project.name) {
    await api(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    await loadProjects();
  }

  showProjectView(projectId);
}

function getProjectBreadcrumb(id) {
  const path = [];
  function find(nodes, target, trail) {
    for (const node of nodes) {
      const currentTrail = [...trail, { id: node.id, name: node.name }];
      if (node.id === target) {
        path.push(...currentTrail);
        return true;
      }
      if (node.children && find(node.children, target, currentTrail)) return true;
    }
    return false;
  }
  find(projectTree, id, []);
  return path;
}

function renderDateGroups(grouped) {
  const container = document.getElementById('dateGroups');
  const dates = Object.keys(grouped).sort().reverse();

  if (dates.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📤</div>
        <h3>리포트를 업로드하세요</h3>
        <p>이 프로젝트에 아직 업로드된 리포트가 없습니다.</p>
        <button class="btn btn-primary" onclick="openUploadModal()">리포트 업로드</button>
      </div>
    `;
    return;
  }

  container.innerHTML = dates.map(date => {
    const reports = grouped[date];
    return `
      <div class="date-group">
        <div class="date-group-header">
          📅 <span class="date-badge">${date}</span>
          <span style="margin-left:auto; font-size:12px; color:var(--text-secondary)">${reports.length}건</span>
        </div>
        <div class="report-items">
          ${reports.map(r => {
            const typeIcon = r.type === 'folder' ? '📂' : r.type === 'markdown' ? '📝' : r.type === 'gsheet' ? '📊' : r.type === 'diagram' ? '📈' : '📄';
            const typeBadge = r.type === 'folder' ? '<span class="type-badge">ZIP</span>'
              : r.type === 'markdown' ? '<span class="type-badge md">MD</span>'
              : r.type === 'gsheet' ? '<span class="type-badge gsheet">Sheets</span>'
              : r.type === 'diagram' ? '<span class="type-badge diagram">Diagram</span>' : '';
            const autoBadge = r.automation ? '<span class="type-badge automation" title="자동화 테스트 결과">🤖 자동화</span>' : '';
            // 행(제목) 클릭 = 대시보드 토글, 결과서 열람은 전용 버튼(📄)으로
            const viewBtn = `<button class="btn-icon-sm" onclick="event.stopPropagation(); viewReport('${r.id}', '${escapeAttr(r.indexPath)}', '${escapeAttr(r.originalName)}')" title="결과서 보기">📄</button>`;
            // 다이어그램/MD 원본 파일은 렌더 페이지로 새 탭 열기
            const directUrl = (r.type === 'diagram' || r.type === 'markdown') ? `/api/reports/${r.id}/render` : `/uploads/${r.indexPath}`;
            const refreshBtn = r.type === 'gsheet'
              ? `<button class="btn-icon-sm" onclick="event.stopPropagation(); refreshReport('${r.id}')" title="최신 데이터로 새로고침">🔄</button>` : '';
            return `
            <div class="report-item" onclick="toggleDashboard('${r.id}', '${r.type}')" title="클릭하면 대시보드가 펼쳐집니다">
              <span class="ri-icon">${typeIcon}</span>
              <div class="ri-info">
                <div class="ri-name">${escapeHtml(r.originalName)} ${typeBadge}${autoBadge}</div>
                <div class="ri-meta">${r.uploadedBy} · ${formatTime(r.uploadedAt)}${r.lastRefreshedAt ? ' · 🔄 ' + formatTime(r.lastRefreshedAt) : ''}</div>
              </div>
              <div class="ri-actions">
                ${viewBtn}
                ${refreshBtn}
                <button class="btn-icon-sm" onclick="event.stopPropagation(); openReportDirect('${escapeAttr(directUrl)}')" title="새 탭에서 열기">↗</button>
                <button class="btn-icon-sm danger" onclick="event.stopPropagation(); deleteReport('${r.id}')" title="삭제">🗑</button>
              </div>
            </div>
            <div class="report-dashboard hidden" id="dashboard-${r.id}"></div>
          `}).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ===== Viewer =====
function viewReport(id, indexPath, originalName) {
  navigateTo(`#project/${currentProjectId}/report/${id}`);
}

async function loadAndShowReport(projectId, reportId) {
  const grouped = await api(`/api/projects/${projectId}/reports`);
  let report = null;
  for (const date of Object.keys(grouped)) {
    const found = grouped[date].find(r => r.id === reportId);
    if (found) { report = found; break; }
  }

  if (report) {
    if (report.type === 'markdown' || report.type === 'diagram') {
      currentReportUrl = `/api/reports/${report.id}/render`;
    } else {
      currentReportUrl = `/uploads/${report.indexPath}`;
    }
    document.getElementById('viewerTitle').textContent = report.originalName;
    setViewerFrameUrl(currentReportUrl);
    showView('reportViewer');
  } else {
    navigateTo(`#project/${projectId}`);
  }
}

// iframe 로드를 히스토리에 쌓지 않고 수행 — src 대입은 조인트 히스토리에 항목이 추가되어
// 브라우저 뒤로가기를 두 번 눌러야 하는 문제(1회차: iframe 만 about:blank) 발생
function setViewerFrameUrl(url) {
  const frame = document.getElementById('viewerFrame');
  try {
    frame.contentWindow.location.replace(url || 'about:blank');
  } catch (e) {
    frame.src = url; // 교차 출처 등으로 접근 불가 시 폴백
  }
}

function goBackToProject() {
  setViewerFrameUrl('');
  hideViewerJump();
  if (currentProjectId) {
    navigateTo(`#project/${currentProjectId}`);
  } else {
    navigateTo('#');
  }
}

function openReportNewTab() {
  if (currentReportUrl) window.open(currentReportUrl, '_blank');
}

// ===== Viewer Navigation (상하 이동 + 진행률 + 그룹 점프) =====

function viewerDoc() {
  const frame = document.getElementById('viewerFrame');
  try { return frame && frame.src ? frame.contentDocument : null; } catch (_) { return null; }
}

// 실제 세로 스크롤이 일어나는 대상 탐색 — 신형 gsheet HTML 은 .table-wrapper 가 스크롤 컨테이너,
// 구형/md/일반 HTML 은 문서 자체가 스크롤
function viewerScrollTarget(doc) {
  const active = doc.querySelector('.sheet-content.active .table-wrapper') || doc.querySelector('.table-wrapper');
  if (active && active.scrollHeight - active.clientHeight > 30) return active;
  return doc.scrollingElement || doc.documentElement;
}

function viewerScrollTo(where) {
  const doc = viewerDoc();
  if (!doc) return;
  const t = viewerScrollTarget(doc);
  t.scrollTo({ top: where === 'top' ? 0 : t.scrollHeight, behavior: 'smooth' });
}

function updateViewerProgress() {
  const el = document.getElementById('viewerProgress');
  if (!el) return;
  const doc = viewerDoc();
  if (!doc) { el.textContent = ''; return; }
  const t = viewerScrollTarget(doc);
  const max = t.scrollHeight - t.clientHeight;
  el.textContent = max > 30 ? Math.min(100, Math.round((t.scrollTop / max) * 100)) + '%' : '';
}

function initViewerNav() {
  const doc = viewerDoc();
  hideViewerJump();
  updateViewerProgress();
  if (!doc) return;
  // scroll 은 버블링하지 않으므로 capture 로 문서·내부 컨테이너 스크롤 모두 감지
  doc.addEventListener('scroll', updateViewerProgress, true);
}

// ── 그룹 점프: 표의 분류 컬럼 값이 바뀌는 행으로 이동 (표 없으면 헤딩 목차) ──
let _viewerJumpRows = [];

function hideViewerJump() {
  const panel = document.getElementById('viewerJumpPanel');
  if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
}

function toggleViewerJump() {
  const panel = document.getElementById('viewerJumpPanel');
  if (!panel) return;
  if (!panel.classList.contains('hidden')) { hideViewerJump(); return; }
  buildViewerJumpPanel();
  panel.classList.remove('hidden');
}

function viewerActiveTable(doc) {
  return doc.querySelector('.sheet-content.active table') || doc.querySelector('table');
}

function buildViewerJumpPanel() {
  const panel = document.getElementById('viewerJumpPanel');
  const doc = viewerDoc();
  if (!doc) { panel.innerHTML = '<div class="vj-empty">리포트가 로드되지 않았습니다.</div>'; return; }

  const table = viewerActiveTable(doc);
  if (table && table.querySelectorAll('tbody tr').length > 3) {
    const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
    // 기본 그룹 컬럼: '분류' 포함 헤더 우선, 없으면 두 번째 컬럼
    let defaultIdx = headers.findIndex(h => h.includes('분류') || h.toLowerCase() === 'category');
    if (defaultIdx < 0) defaultIdx = Math.min(1, headers.length - 1);
    panel.innerHTML = `
      <div class="vj-row">
        <label class="vj-label">그룹 기준</label>
        <select class="vj-select" id="vjColSelect" onchange="renderViewerJumpGroups(this.value)">
          ${headers.map((h, i) => `<option value="${i}" ${i === defaultIdx ? 'selected' : ''}>${escapeHtml(h || '(컬럼 ' + (i + 1) + ')')}</option>`).join('')}
        </select>
      </div>
      <div class="vj-groups" id="vjGroups"></div>`;
    renderViewerJumpGroups(defaultIdx);
    return;
  }

  // 표가 없으면 헤딩 목차 (md/일반 HTML 리포트)
  const heads = Array.from(doc.querySelectorAll('h1, h2, h3')).filter(h => h.textContent.trim());
  if (heads.length) {
    _viewerJumpRows = heads;
    panel.innerHTML = `<div class="vj-groups">${heads.map((h, i) =>
      `<button type="button" class="vj-group" style="padding-left:${(parseInt(h.tagName[1], 10) - 1) * 14 + 10}px"
        onclick="viewerJumpTo(${i})">${escapeHtml(h.textContent.trim().slice(0, 60))}</button>`
    ).join('')}</div>`;
    return;
  }
  panel.innerHTML = '<div class="vj-empty">이동할 그룹/목차를 찾지 못했습니다.</div>';
}

function renderViewerJumpGroups(colIdx) {
  const doc = viewerDoc();
  const box = document.getElementById('vjGroups');
  if (!doc || !box) return;
  const table = viewerActiveTable(doc);
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const idx = parseInt(colIdx, 10);

  // 값이 바뀌는 행 수집 (빈 셀은 이전 그룹 지속 — 시트 병합 셀 대응)
  const groups = [];
  let current = null;
  rows.forEach((tr) => {
    const cell = tr.cells[idx];
    const v = cell ? cell.textContent.trim() : '';
    if (v && v !== (current && current.label)) {
      current = { label: v, row: tr, count: 0 };
      groups.push(current);
    }
    if (current) current.count++;
  });

  if (groups.length < 2 || groups.length > 200) {
    box.innerHTML = `<div class="vj-empty">이 컬럼은 그룹 구분에 적합하지 않습니다 (${groups.length}개 그룹). 다른 컬럼을 선택해 보세요.</div>`;
    _viewerJumpRows = [];
    return;
  }
  _viewerJumpRows = groups.map(g => g.row);
  box.innerHTML = groups.map((g, i) =>
    `<button type="button" class="vj-group" onclick="viewerJumpTo(${i})">${escapeHtml(g.label.slice(0, 40))} <span class="vj-count">${g.count}</span></button>`
  ).join('');
}

function viewerJumpTo(i) {
  const el = _viewerJumpRows[i];
  const doc = viewerDoc();
  if (!el || !doc) return;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  // sticky 헤더에 가려지지 않게 살짝 위로 보정
  setTimeout(() => {
    const t = viewerScrollTarget(doc);
    t.scrollBy(0, -44);
  }, 350);
  // 도착 지점 하이라이트
  const orig = el.style.backgroundColor;
  el.style.transition = 'background-color 0.4s';
  el.style.backgroundColor = '#fff3bf';
  setTimeout(() => { el.style.backgroundColor = orig; }, 1600);
}

function openReportDirect(url) {
  window.open(url, '_blank');
}

// ===== Upload =====
function setupUploadZone() {
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.name.endsWith('.html') || f.name.endsWith('.zip') || f.name.endsWith('.md')
    );
    addFiles(files);
  });

  input.addEventListener('change', () => {
    addFiles(Array.from(input.files));
    input.value = '';
  });
}

function addFiles(files) {
  selectedFiles = [...selectedFiles, ...files];
  renderFileList();
  document.getElementById('uploadBtn').disabled = selectedFiles.length === 0;
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
  document.getElementById('uploadBtn').disabled = selectedFiles.length === 0;
}

function renderFileList() {
  const list = document.getElementById('uploadFileList');
  list.innerHTML = selectedFiles.map((f, i) => `
    <div class="upload-file-item">
      <span>📄</span>
      <span class="file-name">${escapeHtml(f.name)}</span>
      <button class="file-remove" onclick="removeFile(${i})">✕</button>
    </div>
  `).join('');
}

async function uploadFiles() {
  if (!currentProjectId || selectedFiles.length === 0) return;

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.textContent = '업로드 중...';
  showLoadingOverlay('파일을 업로드하고 있습니다...');

  const uploaderName = document.getElementById('uploaderName').value.trim() || '익명';
  localStorage.setItem('uploaderName', uploaderName);

  try {
    const staged = await stageFilesWithProgress(selectedFiles);
    showLoadingOverlay('업로드를 처리하고 있습니다…');
    const formData = new FormData();
    formData.append('stagedFiles', JSON.stringify(staged));
    formData.append('date', document.getElementById('uploadDate').value);
    formData.append('uploadedBy', uploaderName);
    if (document.getElementById('uploadAutomation').checked) formData.append('automation', '1');
    const res = await fetch(`/api/projects/${currentProjectId}/reports`, {
      method: 'POST',
      body: formData
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.error) throw new Error(d.error || `업로드 실패 (${res.status})`);

    selectedFiles = [];
    renderFileList();
    closeModal('uploadModal');
    hideLoadingOverlay();
    if (d.consolidated) {
      // 결과형 프로젝트 — Playwright ZIP 자동 감지·취합 결과 안내
      const n = (d.sources || []).length;
      const rowSum = (d.sources || []).reduce((a, s) => a + (s.rowCount || 0), 0);
      if (n) showToast(`✅ 취합 완료 — 소스 ${n}개 · ${rowSum}행 반영`, 'success');
      (d.skipped || []).forEach(s => showToast(`⚠️ ${s.file}: ${s.reason}`, 'error'));
      if (!n && !(d.skipped || []).length) showToast('업로드된 파일이 없습니다', 'error');
    } else {
      showToast('✅ 업로드 완료', 'success');
      (d.notices || []).forEach(m => showToast('💡 ' + m, 'info'));
    }
    await loadProjects();
    showProjectView(currentProjectId);
  } catch (e) {
    hideLoadingOverlay();
    showToast('❌ 업로드 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '업로드';
  }
}

// ===== Delete =====
async function deleteReport(id) {
  if (!confirm('이 리포트를 삭제하시겠습니까?')) return;
  await api(`/api/reports/${id}`, { method: 'DELETE' });
  await loadProjects();
  if (currentProjectId) showProjectView(currentProjectId);
}

// ===== Report Dashboard =====
async function toggleDashboard(reportId, reportType) {
  // 다이어그램/MD 문서는 통계 대시보드가 없으므로 바로 뷰어로
  if (reportType === 'diagram' || reportType === 'markdown') return viewReport(reportId);

  const el = document.getElementById(`dashboard-${reportId}`);
  if (!el) return;

  // 이미 열려있으면 접기
  if (!el.classList.contains('hidden')) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }

  // 로딩 표시
  el.classList.remove('hidden');
  el.innerHTML = '<div class="dashboard-loading"><div class="loading-spinner-sm"></div> 통계 분석 중...</div>';

  try {
    const stats = await api(`/api/reports/${reportId}/stats`);

    if (stats.total === 0) {
      el.innerHTML = '<div class="dashboard-empty">결과 데이터를 찾을 수 없습니다.</div>';
      return;
    }

    const aiOn = reportType === 'gsheet' && QA_CONFIG && QA_CONFIG.aiEnabled;
    el.innerHTML = renderDashboardPanel(stats, reportId, aiOn);
    if (reportType === 'gsheet') loadCustomMetrics(reportId);
    if (aiOn && stats.fail > 0) loadFailAnalysis(reportId);
  } catch (e) {
    el.innerHTML = '<div class="dashboard-empty">통계 추출에 실패했습니다.</div>';
  }
}

function renderDashboardPanel(stats, reportId, aiOn) {
  // Pass Rate 게이지 색상
  const rateColor = stats.passRate >= 90 ? '#22c55e' : stats.passRate >= 70 ? '#f59e0b' : '#ef4444';
  const execColor = stats.executionRate >= 80 ? '#22c55e' : stats.executionRate >= 50 ? '#f59e0b' : '#6b7280';

  // 시트별 바 차트
  const sheetsHtml = stats.sheets.length > 1 ? `
    <div class="dash-section">
      <div class="dash-section-title">시트별 결과</div>
      <div class="dash-sheets">
        ${stats.sheets.map(sh => {
          const shExec = sh.pass + sh.fail;
          const sheetRate = shExec > 0 ? Math.round((sh.pass / shExec) * 100) : 0;
          const barColor = sheetRate >= 90 ? '#22c55e' : sheetRate >= 70 ? '#f59e0b' : '#ef4444';
          return shExec > 0 ? `
            <div class="dash-sheet-row">
              <span class="dash-sheet-name">${escapeHtml(sh.name)}</span>
              <div class="dash-bar-track">
                <div class="dash-bar-fill" style="width:${sheetRate}%; background:${barColor}"></div>
              </div>
              <span class="dash-sheet-stat">${sh.pass}/${shExec} (${sheetRate}%)</span>
            </div>
          ` : '';
        }).join('')}
      </div>
    </div>
  ` : '';

  // Fail 항목 리스트 — 기본 접힘, 클릭으로 펼치기 (항목이 많은 리포트 대응)
  const failHtml = stats.failItems.length > 0 ? `
    <div class="dash-section">
      <button type="button" class="dash-fail-toggle" onclick="toggleFailList('${reportId}')">
        ❌ Fail 항목 (${stats.fail}건)
        <span class="fail-caret" id="fail-caret-${reportId}">▸ 펼쳐보기</span>
      </button>
      <div class="dash-fail-list hidden" id="fail-list-${reportId}">
        ${stats.failItems.map(item => `
          <div class="dash-fail-item">
            <span class="dash-fail-sheet">${escapeHtml(item.sheet)}</span>
            <span class="dash-fail-cells">${item.cells.map(c => escapeHtml(c)).join(' → ')}</span>
          </div>
        `).join('')}
        ${stats.fail > stats.failItems.length ? `<div class="dash-fail-more">… 외 ${stats.fail - stats.failItems.length}건 (상위 ${stats.failItems.length}건만 표시 — 전체는 결과서에서 확인)</div>` : ''}
      </div>
    </div>
  ` : '';

  // 상세 대시보드 — 특징 축(거래소/기기/테스터 등)이 감지된 리포트만 버튼 노출
  const detailHtml = stats.detailAvailable ? `
    <div class="dash-section">
      <button type="button" class="dash-fail-toggle" onclick="toggleDetailDashboard('${reportId}')">
        📊 상세 대시보드 (특징 축 ${stats.detailAxes}개)
        <span class="fail-caret" id="detail-caret-${reportId}">▸ 펼쳐보기</span>
      </button>
      <div class="dash-detail hidden" id="detail-${reportId}"></div>
    </div>
  ` : '';

  return `
    <div class="dash-panel">
      <div class="dash-summary">
        <div class="dash-rate">
          <div class="dash-rate-circle" style="--rate:${stats.passRate}; --color:${rateColor}">
            <span class="dash-rate-value">${stats.passRate}%</span>
          </div>
          <div class="dash-rate-label">Pass Rate</div>
        </div>
        <div class="dash-rate">
          <div class="dash-rate-circle" style="--rate:${stats.executionRate}; --color:${execColor}">
            <span class="dash-rate-value">${stats.executionRate}%</span>
          </div>
          <div class="dash-rate-label">실행률 (${stats.executed}/${stats.total})</div>
        </div>
        <div class="dash-counts">
          <div class="dash-count pass"><span class="dash-count-value">${stats.pass}</span><span class="dash-count-label">Pass</span></div>
          <div class="dash-count fail"><span class="dash-count-value">${stats.fail}</span><span class="dash-count-label">Fail</span></div>
          <div class="dash-count skip"><span class="dash-count-value">${stats.skip}</span><span class="dash-count-label">N/T</span></div>
          ${stats.na ? `<div class="dash-count na" title="해당 없음 — Total·실행률 모수에서 제외"><span class="dash-count-value">${stats.na}</span><span class="dash-count-label">N/A</span></div>` : ''}
          <div class="dash-count total" title="Pass + Fail + N/T (N/A 제외)"><span class="dash-count-value">${stats.total}</span><span class="dash-count-label">Total</span></div>
        </div>
      </div>
      <div class="dash-section dash-custom-section hidden" id="custom-metrics-${reportId}"></div>
      ${detailHtml}
      ${sheetsHtml}
      ${failHtml}
      ${aiOn && stats.fail > 0 ? `<div class="dash-section fail-analysis" id="fail-analysis-${reportId}"></div>` : ''}
      ${aiOn ? renderAiSection(reportId) : ''}
    </div>
  `;
}

function toggleFailList(reportId) {
  const list = document.getElementById(`fail-list-${reportId}`);
  const caret = document.getElementById(`fail-caret-${reportId}`);
  if (!list) return;
  list.classList.toggle('hidden');
  if (caret) caret.textContent = list.classList.contains('hidden') ? '▸ 펼쳐보기' : '▾ 접기';
}

// ===== 상세 대시보드 (특징 축별 결과 분포) =====

async function toggleDetailDashboard(reportId) {
  const el = document.getElementById(`detail-${reportId}`);
  const caret = document.getElementById(`detail-caret-${reportId}`);
  if (!el) return;
  if (!el.classList.contains('hidden')) {
    el.classList.add('hidden');
    if (caret) caret.textContent = '▸ 펼쳐보기';
    return;
  }
  el.classList.remove('hidden');
  if (caret) caret.textContent = '▾ 접기';
  if (el.dataset.loaded) return;

  el.innerHTML = '<div class="dashboard-loading"><div class="loading-spinner-sm"></div> 상세 분석 중...</div>';
  try {
    const d = await api(`/api/reports/${reportId}/stats/detail`);
    if (d.error) {
      el.innerHTML = `<div class="dashboard-empty">${escapeHtml(d.error)}</div>`;
      return;
    }
    el.innerHTML = renderDetailPanel(d);
    el.dataset.loaded = '1';
  } catch (e) {
    el.innerHTML = '<div class="dashboard-empty">상세 통계 계산에 실패했습니다.</div>';
  }
}

// 스택 바 한 줄: 라벨 | Pass/Fail/N-T/N-A 누적 바 | 건수
function renderStackRow(label, c) {
  const denom = c.total + (c.na || 0);
  if (!denom) return '';
  const seg = (n, cls, title) => n ? `<div class="stack-seg ${cls}" style="width:${(n / denom * 100).toFixed(1)}%" title="${title} ${n}건"></div>` : '';
  const counts = [
    c.pass ? `P ${c.pass}` : '',
    c.fail ? `F ${c.fail}` : '',
    c.nt ? `N/T ${c.nt}` : '',
    c.na ? `N/A ${c.na}` : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="detail-row">
      <span class="detail-row-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <div class="detail-stack">
        ${seg(c.pass, 'seg-pass', 'Pass')}${seg(c.fail, 'seg-fail', 'Fail')}${seg(c.nt, 'seg-nt', 'N/T')}${seg(c.na, 'seg-na', 'N/A')}
      </div>
      <span class="detail-row-counts">${counts}</span>
    </div>`;
}

function renderDetailPanel(d) {
  const deviceRows = (d.devices || []).map(dev => renderStackRow(dev.name, dev)).join('');
  const devicesHtml = deviceRows ? `
    <div class="detail-group">
      <div class="dash-section-title">결과 컬럼별 (기기·테스터·환경)</div>
      ${deviceRows}
    </div>` : '';

  const axesHtml = (d.axes || []).map(ax => {
    const rows = ax.values.map(v => renderStackRow(v.value, v)).join('');
    return rows ? `
      <div class="detail-group">
        <div class="dash-section-title">${escapeHtml(ax.name)}</div>
        ${rows}
      </div>` : '';
  }).join('');

  if (!devicesHtml && !axesHtml) return '<div class="dashboard-empty">표시할 특징 축이 없습니다.</div>';
  return `
    <div class="detail-legend">
      <span class="legend-item"><i class="legend-dot seg-pass"></i>Pass</span>
      <span class="legend-item"><i class="legend-dot seg-fail"></i>Fail</span>
      <span class="legend-item"><i class="legend-dot seg-nt"></i>N/T</span>
      <span class="legend-item"><i class="legend-dot seg-na"></i>N/A</span>
    </div>
    ${devicesHtml}${axesHtml}`;
}

// ===== Fail 분석 및 결함 후보 (자동 생성 — Fail 있을 때만) =====

// AI 엔드포인트 — 단건 리포트와 취합 뷰(cons-<projectId>)가 같은 UI 를 공유
function aiEndpoint(id, kind) { // kind: 'chat' | 'fail-analysis'
  return id.startsWith('cons-')
    ? `/api/projects/${id.slice(5)}/consolidated/${kind}`
    : `/api/reports/${id}/${kind}`;
}

async function loadFailAnalysis(reportId, force) {
  const el = document.getElementById(`fail-analysis-${reportId}`);
  if (!el) return;
  el.innerHTML = `
    <div class="dash-section-title">🔬 Fail 분석 및 결함 후보</div>
    <div class="fa-loading"><div class="loading-spinner-sm"></div> 결함 패턴 분석 중… ${force ? '' : '(첫 분석은 10초 정도 걸립니다)'}</div>`;
  try {
    const d = await api(`${aiEndpoint(reportId, 'fail-analysis')}${force ? '?force=1' : ''}`);
    if (!d || d.disabled || d.none) { el.innerHTML = ''; return; }
    if (d.error) {
      el.innerHTML = `
        <div class="dash-section-title">🔬 Fail 분석 및 결함 후보</div>
        <div class="fa-error">⚠️ ${escapeHtml(d.error)}
          <button type="button" class="fa-refresh" onclick="loadFailAnalysis('${reportId}')">재시도</button>
        </div>`;
      return;
    }
    el.innerHTML = `
      <div class="dash-section-title">🔬 Fail 분석 및 결함 후보
        <span class="fa-meta">Fail ${d.failCount}건 · ${formatTime(d.generatedAt)} 분석</span>
        <button type="button" class="fa-refresh" onclick="loadFailAnalysis('${reportId}', true)" title="다시 분석">↻ 다시 분석</button>
      </div>
      <div class="fa-body">${renderFaMarkdown(d.markdown)}</div>`;
  } catch (_) {
    el.innerHTML = `
      <div class="dash-section-title">🔬 Fail 분석 및 결함 후보</div>
      <div class="fa-error">⚠️ 분석을 불러오지 못했습니다.
        <button type="button" class="fa-refresh" onclick="loadFailAnalysis('${reportId}')">재시도</button>
      </div>`;
  }
}

// 분석 결과용 초경량 마크다운 렌더 (###, **, - 만 지원 — 전체 escapeHtml 선적용)
function renderFaMarkdown(md) {
  return String(md || '').split('\n').map((line) => {
    const esc = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^###\s+/.test(line)) return `<div class="fa-h">${esc.replace(/^###\s+/, '')}</div>`;
    if (/^-\s+/.test(line)) return `<div class="fa-li">• ${esc.replace(/^-\s+/, '')}</div>`;
    if (!line.trim()) return '';
    return `<div class="fa-p">${esc}</div>`;
  }).join('');
}

// ===== AI Q&A + 커스텀 지표 (report-ai-qa) =====

// 리포트별 대화 상태 (브라우저 메모리 — 휘발성)
const aiChat = {};

const AI_PRESET_QUESTIONS = [
  { label: '상태별 분포', q: '자동화상태(또는 상태) 컬럼의 값별 분포를 알려줘.' },
  { label: 'Fail 원인 요약', q: 'Fail 항목들을 요약하고 공통 원인이 있는지 알려줘.' },
  { label: '실행 안 된 항목', q: '실행되지 않은(N/T, 미수행) 항목은 몇 건이야?' },
];

function renderAiSection(reportId) {
  // 취합 뷰(cons-*) 전용 칩 — AI 호출 없이 프론트가 거래소별 위젯을 직접 렌더
  const consChips = String(reportId).startsWith('cons-')
    ? `<button type="button" class="ai-chip" onclick="showExchangeStats('${reportId}')">거래소별 결과 통계</button>`
    : '';
  const chips = AI_PRESET_QUESTIONS.map(p =>
    `<button type="button" class="ai-chip" data-q="${escapeAttr(p.q)}" onclick="sendAiQuestion('${reportId}', this.dataset.q)">${escapeHtml(p.label)}</button>`
  ).join('') + consChips;
  return `
    <div class="dash-section ai-section">
      <button type="button" class="ai-toggle" onclick="toggleAiPanel('${reportId}')">
        🤖 AI 에게 질문 <span class="ai-caret" id="ai-caret-${reportId}">▾</span>
      </button>
      <div class="ai-panel hidden" id="ai-panel-${reportId}">
        <div class="ai-chips">${chips}</div>
        <div class="ai-messages" id="ai-messages-${reportId}"></div>
        <div class="ai-input-row">
          <input type="text" id="ai-input-${reportId}" class="ai-input" maxlength="1000"
            placeholder="이 결과서에 대해 질문하세요... (예: IMPLEMENTED 중 Pass 비율은?)"
            onkeydown="if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){sendAiQuestion('${reportId}');}">
          <button type="button" class="btn btn-primary btn-sm" id="ai-send-${reportId}" onclick="sendAiQuestion('${reportId}')">전송</button>
        </div>
      </div>
    </div>`;
}

// 거래소별 결과 통계 카드 HTML — 채팅 위젯·고정 섹션 공용 (consolidatedData.rows 집계, AI 미호출)
function buildExchangeCards() {
  if (!consolidatedData || !consolidatedData.rows) return '';
  const groups = {};
  for (const r of consolidatedData.rows) {
    const ex = r.exchange || '미지정';
    const g = groups[ex] = groups[ex] || { pass: 0, fail: 0, nt: 0, blocked: 0, suites: {} };
    if (r.final === 'Pass') g.pass++;
    else if (r.final === 'Fail') g.fail++;
    else if (r.final === 'Blocked') g.blocked++;
    else g.nt++;
    const suName = r.suite || '기타';
    const su = g.suites[suName] = g.suites[suName] || { pass: 0, fail: 0, nt: 0 };
    if (r.final === 'Pass') su.pass++;
    else if (r.final === 'Fail' || r.final === 'Blocked') su.fail++;
    else su.nt++;
  }
  const names = Object.keys(groups).sort();
  if (!names.length) return '';

  return names.map(name => {
    const g = groups[name];
    const executed = g.pass + g.fail + g.blocked;
    const total = executed + g.nt;
    const rate = executed ? Math.round((g.pass / executed) * 100) : 0;
    const color = rate >= 90 ? '#22c55e' : rate >= 70 ? '#f59e0b' : '#ef4444';
    const suites = Object.entries(g.suites)
      .map(([s, v]) => ({ s, ...v, total: v.pass + v.fail + v.nt }))
      .sort((a, b) => b.total - a.total).slice(0, 6);
    const suiteRows = suites.map(v => {
      const seg = (n, cls, t) => n ? `<div class="stack-seg ${cls}" style="width:${((n / v.total) * 100).toFixed(1)}%" title="${t} ${n}건"></div>` : '';
      return `
        <div class="exch-suite-row">
          <span class="exch-suite-label" title="${escapeAttr(v.s)}">${escapeHtml(String(v.s).split('/').pop())}</span>
          <div class="detail-stack">${seg(v.pass, 'seg-pass', 'Pass')}${seg(v.fail, 'seg-fail', 'Fail')}${seg(v.nt, 'seg-nt', 'N/T')}</div>
          <span class="exch-suite-counts">${v.pass}/${v.total}</span>
        </div>`;
    }).join('');
    return `
      <div class="exch-card">
        <div class="exch-card-head">${escapeHtml(name)}</div>
        <div class="exch-card-gauge">
          <div class="dash-rate-circle exch-gauge" style="--rate:${rate}; --color:${color}"><span class="dash-rate-value">${rate}%</span></div>
          <div class="exch-card-counts">
            <span class="res-badge res-Pass">P ${g.pass}</span>
            <span class="res-badge res-Fail">F ${g.fail + g.blocked}</span>
            <span class="res-badge res-NT">N/T ${g.nt}</span>
            <span class="exch-total">전체 ${total} · Pass율 ${rate}% (${g.pass}/${executed})</span>
          </div>
        </div>
        ${suiteRows ? `<div class="exch-suites">${suiteRows}</div>` : ''}
      </div>`;
  }).join('');
}

// '거래소별 결과 통계' 칩 — 채팅 영역에 위젯 말풍선 렌더 + 📌 고정 버튼
function showExchangeStats(reportId) {
  const cards = buildExchangeCards();
  if (!cards) { appendAiBubble(reportId, 'assistant', '거래소 정보가 있는 결과가 없습니다.'); return; }
  appendAiBubble(reportId, 'user', '거래소별 결과 통계');
  const pinned = (consolidatedData.pinnedWidgets || []).includes('exchangeStats');
  const pinBtn = pinned
    ? `<button type="button" class="ai-pin" disabled>✅ 고정됨</button>`
    : `<button type="button" class="ai-pin" onclick="pinConsWidget('exchangeStats', this)">📌 대시보드에 고정</button>`;
  appendAiBubble(reportId, 'assistant', `<div class="exch-cards">${cards}</div><div class="exch-pin-row">${pinBtn}</div>`);
}

// 위젯 고정/해제 — project.pinnedWidgets (서버 저장, 프로젝트 열람자 공유)
async function pinConsWidget(key, btn) {
  if (!consProjectId) return;
  if (btn) btn.disabled = true;
  const d = await api(`/api/projects/${consProjectId}/widgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!d || d.error) {
    if (btn) btn.disabled = false;
    showToast('❌ ' + ((d && d.error) || '고정 실패'), 'error');
    return;
  }
  consolidatedData.pinnedWidgets = d.pinnedWidgets;
  if (btn) btn.textContent = '✅ 고정됨';
  showToast('📌 대시보드에 고정되었습니다', 'success');
  renderConsPinned();
}

async function unpinConsWidget(key) {
  if (!consProjectId) return;
  if (!confirm('고정된 위젯을 해제할까요?')) return;
  const d = await api(`/api/projects/${consProjectId}/widgets/${key}`, { method: 'DELETE' });
  if (!d || d.error) { showToast('❌ ' + ((d && d.error) || '해제 실패'), 'error'); return; }
  consolidatedData.pinnedWidgets = d.pinnedWidgets;
  renderConsPinned();
}

// 고정된 위젯 섹션 — 부분 렌더 (AI 대화 DOM 보존을 위해 전체 재렌더 금지)
function renderConsPinned() {
  const box = document.getElementById('consPinnedBox');
  if (!box || !consolidatedData) return;
  const pinned = consolidatedData.pinnedWidgets || [];
  if (!pinned.includes('exchangeStats')) { box.innerHTML = ''; return; }
  const cards = buildExchangeCards();
  box.innerHTML = cards ? `
    <div class="dash-panel cons-pinned">
      <div class="dash-section-title exch-pinned-head">📌 거래소별 결과 통계
        <button type="button" class="btn-icon-sm" title="고정 해제" onclick="unpinConsWidget('exchangeStats')">✕</button>
      </div>
      <div class="exch-cards">${cards}</div>
    </div>` : '';
}

function toggleAiPanel(reportId) {
  const panel = document.getElementById(`ai-panel-${reportId}`);
  const caret = document.getElementById(`ai-caret-${reportId}`);
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (caret) caret.textContent = panel.classList.contains('hidden') ? '▾' : '▴';
}

function appendAiBubble(reportId, role, html) {
  const box = document.getElementById(`ai-messages-${reportId}`);
  if (!box) return null;
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.innerHTML = `<div class="ai-text">${html}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function renderAiText(bubble, text) {
  const el = bubble && bubble.querySelector('.ai-text');
  if (el) el.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
}

function parseSseChunk(chunk) {
  let event = null, data = null;
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) data = line.slice(6);
  }
  if (!event || data == null) return null;
  try { return { event, data: JSON.parse(data) }; } catch (_) { return null; }
}

async function sendAiQuestion(reportId, preset) {
  const st = aiChat[reportId] = aiChat[reportId] || { messages: [], defs: {}, seq: 0, busy: false };
  if (st.busy) return;

  const input = document.getElementById(`ai-input-${reportId}`);
  const question = (preset || (input && input.value) || '').trim();
  if (!question) return;
  if (input && !preset) input.value = '';

  st.messages.push({ role: 'user', content: question });
  appendAiBubble(reportId, 'user', escapeHtml(question));
  const bubble = appendAiBubble(reportId, 'assistant', '<span class="ai-typing">생각 중…</span>');

  st.busy = true;
  const sendBtn = document.getElementById(`ai-send-${reportId}`);
  if (sendBtn) sendBtn.disabled = true;

  let assistantText = '';
  try {
    const resp = await fetch(aiEndpoint(reportId, 'chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: st.messages }),
    });
    if (!resp.ok) {
      const d = await resp.json().catch(() => ({}));
      throw new Error(d.error || `AI 응답 실패 (${resp.status})`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const ev = parseSseChunk(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (!ev) continue;
        if (ev.event === 'text') {
          assistantText += ev.data.delta;
          renderAiText(bubble, assistantText);
        } else if (ev.event === 'metric') {
          attachAiMetric(reportId, bubble, ev.data);
        } else if (ev.event === 'error') {
          throw new Error(ev.data.message || 'AI 오류');
        }
        const box = document.getElementById(`ai-messages-${reportId}`);
        if (box) box.scrollTop = box.scrollHeight;
      }
    }
    if (!assistantText) renderAiText(bubble, '(위 계산 결과를 확인해 주세요)');
    st.messages.push({ role: 'assistant', content: assistantText || '(계산 결과 제공됨)' });
  } catch (e) {
    st.messages.pop(); // 실패한 질문은 이력에서 제거 (재시도 가능하게)
    renderAiText(bubble, '');
    bubble.insertAdjacentHTML('beforeend', `<div class="ai-error">⚠️ ${escapeHtml(e.message)}</div>`);
  } finally {
    st.busy = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function attachAiMetric(reportId, bubble, data) {
  const st = aiChat[reportId];
  if (!st || !bubble) return;
  const token = 'm' + (++st.seq);
  st.defs[token] = data.definition;
  const badge = document.createElement('div');
  badge.className = 'ai-metric';
  badge.innerHTML = `
    <span class="ai-metric-value">${escapeHtml(data.computed.display)}</span>
    <span class="ai-metric-label">${escapeHtml(data.definition.label)}</span>
    ${reportId.startsWith('cons-') ? '' : `<button type="button" class="ai-pin" onclick="pinAiMetric('${reportId}', '${token}', this)">📌 대시보드에 추가</button>`}`;
  bubble.appendChild(badge);
}

async function pinAiMetric(reportId, token, btn) {
  const def = aiChat[reportId] && aiChat[reportId].defs[token];
  if (!def) return;
  btn.disabled = true;
  const d = await api(`/api/reports/${reportId}/metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(def),
  });
  if (!d || d.error) {
    btn.disabled = false;
    showToast('❌ ' + ((d && d.error) || '카드 추가 실패'), 'error');
    return;
  }
  btn.textContent = '✅ 추가됨';
  showToast('📌 대시보드에 추가되었습니다', 'success');
  loadCustomMetrics(reportId);
}

async function loadCustomMetrics(reportId) {
  const el = document.getElementById(`custom-metrics-${reportId}`);
  if (!el) return;
  try {
    const d = await api(`/api/reports/${reportId}/metrics`);
    const list = (d && d.metrics) || [];
    if (!list.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="dash-section-title">📌 커스텀 지표</div>
      <div class="dash-custom-cards">
        ${list.map(m => `
          <div class="dash-custom-card${m.error ? ' error' : ''}">
            <span class="dcc-value">${m.error ? '⚠️' : escapeHtml(m.display)}</span>
            <span class="dcc-label">${escapeHtml(m.label)}${m.error ? ' — ' + escapeHtml(m.error) : ''}</span>
            <button type="button" class="dcc-del" title="카드 삭제" data-label="${escapeAttr(m.label)}"
              onclick="deleteCustomMetric('${reportId}', '${m.id}', this.dataset.label)">✕</button>
          </div>`).join('')}
      </div>`;
  } catch (_) { /* 지표 로드 실패는 대시보드 자체를 막지 않음 */ }
}

async function deleteCustomMetric(reportId, metricId, label) {
  if (!confirm(`'${label}' 카드를 삭제할까요?`)) return;
  const d = await api(`/api/reports/${reportId}/metrics/${metricId}`, { method: 'DELETE' });
  if (d && d.error) { showToast('❌ ' + d.error, 'error'); return; }
  loadCustomMetrics(reportId);
}

// ===== Refresh Google Sheets =====
async function refreshReport(id) {
  // 버튼 로딩 상태
  const btn = document.querySelector(`[onclick*="refreshReport('${id}')"]`);
  if (btn) {
    btn.classList.add('spinning');
    btn.disabled = true;
  }

  showToast('🔄 최신 데이터를 가져오는 중...', 'loading');

  try {
    const result = await api(`/api/reports/${id}/refresh`, { method: 'POST' });
    if (result.error) {
      showToast(`❌ ${result.error}`, 'error');
      return;
    }
    showToast('✅ 최신 데이터로 업데이트 완료', 'success');
    await loadProjects();
    if (currentProjectId) showProjectView(currentProjectId);
  } catch (e) {
    showToast('❌ 새로고침 실패', 'error');
  } finally {
    if (btn) {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
  }
}

// ===== Toast =====
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  // 등장 애니메이션
  requestAnimationFrame(() => toast.classList.add('show'));

  // loading 타입이면 자동으로 안 사라짐 — 다음 토스트가 대체
  if (type === 'loading') {
    toast.dataset.loading = 'true';
    return;
  }

  // 기존 loading 토스트 제거
  container.querySelectorAll('[data-loading="true"]').forEach(el => el.remove());

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ===== Loading Overlay =====
function showLoadingOverlay(message) {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-message"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  overlay.querySelector('.loading-message').textContent = message || '처리 중...';
  overlay.classList.add('show');
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('show');
}

async function deleteCurrentProject() {
  if (!confirm('이 프로젝트와 모든 하위 프로젝트/리포트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
  await api(`/api/projects/${currentProjectId}`, { method: 'DELETE' });
  currentProjectId = null;
  await loadProjects();
  navigateTo('#');
}

// ===== Project Modal =====
let newProjectParentId = null;

function openNewProjectModal(parentId) {
  newProjectParentId = parentId || null;
  document.getElementById('newProjectName').value = '';

  const label = document.getElementById('newProjectParentLabel');
  if (parentId) {
    const parent = findProjectInTree(projectTree, parentId);
    label.textContent = `상위: ${parent ? parent.name : ''}`;
    label.style.display = 'block';
  } else {
    label.style.display = 'none';
  }

  openModal('newProjectModal');
  setTimeout(() => document.getElementById('newProjectName').focus(), 100);
}

async function createProject() {
  const name = document.getElementById('newProjectName').value.trim();
  if (!name) return;

  const isPrivate = document.getElementById('newProjectPrivate').checked;
  const typeEl = document.querySelector('input[name="newProjectType"]:checked');
  const body = { name, visibility: isPrivate ? 'private' : 'public', type: typeEl ? typeEl.value : 'doc' };
  if (newProjectParentId) body.parentId = newProjectParentId;

  const result = await api('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (result.error) {
    alert(result.error);
    return;
  }

  closeModal('newProjectModal');
  await loadProjects();
  selectProject(result.id);
}

// ===== Upload Modal =====
function openUploadModal() {
  selectedFiles = [];
  renderFileList();
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('uploadDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('diagramCode').value = '';
  document.getElementById('diagramName').value = '';
  document.getElementById('uploadAutomation').checked = false;
  switchUploadTab('file');
  openModal('uploadModal');
}

let currentUploadTab = 'file';

function switchUploadTab(tab) {
  currentUploadTab = tab;
  const tabOrder = ['file', 'gsheet', 'diagram'];
  document.querySelectorAll('.upload-tab').forEach((el, i) => {
    el.classList.toggle('active', tabOrder[i] === tab);
  });
  document.getElementById('uploadTabFile').classList.toggle('active', tab === 'file');
  document.getElementById('uploadTabGsheet').classList.toggle('active', tab === 'gsheet');
  document.getElementById('uploadTabDiagram').classList.toggle('active', tab === 'diagram');

  // 버튼 텍스트/활성화 변경
  const btn = document.getElementById('uploadBtn');
  if (tab === 'gsheet') {
    btn.textContent = '가져오기';
    btn.onclick = importGoogleSheet;
    const url = document.getElementById('gsheetUrl').value.trim();
    btn.disabled = !url;
  } else if (tab === 'diagram') {
    btn.textContent = '업로드';
    btn.onclick = uploadDiagram;
    btn.disabled = !document.getElementById('diagramCode').value.trim();
  } else {
    btn.textContent = '업로드';
    btn.onclick = uploadFiles;
    btn.disabled = selectedFiles.length === 0;
  }
}

// ===== 다이어그램 업로드 =====
async function uploadDiagram() {
  const content = document.getElementById('diagramCode').value.trim();
  if (!currentProjectId || !content) return;

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.textContent = '업로드 중...';

  const uploaderName = document.getElementById('uploaderName').value.trim() || '익명';
  localStorage.setItem('uploaderName', uploaderName);

  try {
    const result = await api(`/api/projects/${currentProjectId}/diagrams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('diagramName').value.trim(),
        content,
        date: document.getElementById('uploadDate').value,
        uploadedBy: uploaderName
      })
    });

    if (result.error) {
      showToast(`❌ ${result.error}`, 'error');
      return;
    }

    document.getElementById('diagramCode').value = '';
    document.getElementById('diagramName').value = '';
    closeModal('uploadModal');
    showToast('✅ 다이어그램 업로드 완료', 'success');
    await loadProjects();
    showProjectView(currentProjectId);
  } catch (e) {
    showToast('❌ 업로드 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '업로드';
  }
}

// Google Sheets 관련
async function checkGoogleStatus() {
  const res = await api('/api/google/status');
  const statusEl = document.getElementById('gsheetStatus');

  if (res.connected) {
    statusEl.innerHTML = `
      <div class="gsheet-connected">
        <span>✅ ${escapeHtml(res.user.name)} (${escapeHtml(res.user.email)}) 연결됨</span>
        <button class="btn btn-sm btn-secondary" onclick="disconnectGoogle()">연결 해제</button>
      </div>
    `;
  } else {
    statusEl.innerHTML = `
      <div class="gsheet-disconnected">
        <p>Google 계정으로 로그인하면 Spreadsheet를 가져올 수 있습니다.</p>
        <a href="/auth/google" class="btn btn-primary btn-sm">🔗 Google 로그인</a>
      </div>
    `;
  }
}

async function disconnectGoogle() {
  await api('/api/google/disconnect', { method: 'POST' });
  checkGoogleStatus();
}

async function importGoogleSheet() {
  const url = document.getElementById('gsheetUrl').value.trim();
  if (!url || !currentProjectId) return;

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.textContent = '가져오는 중...';
  showLoadingOverlay('Google Spreadsheet를 불러오고 있습니다...');

  const uploaderName = document.getElementById('uploaderName').value.trim() || '익명';
  localStorage.setItem('uploaderName', uploaderName);

  try {
    const result = await api('/api/google/sheets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        projectId: currentProjectId,
        date: document.getElementById('uploadDate').value,
        uploadedBy: uploaderName,
        automation: document.getElementById('uploadAutomation').checked
      })
    });

    if (result.error) {
      hideLoadingOverlay();
      showToast(`❌ ${result.error}`, 'error');
      return;
    }

    closeModal('uploadModal');
    hideLoadingOverlay();
    showToast('✅ 스프레드시트 가져오기 완료', 'success');
    await loadProjects();
    showProjectView(currentProjectId);
  } catch (e) {
    hideLoadingOverlay();
    showToast('❌ 가져오기 실패: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '가져오기';
  }
}

// gsheet URL / 다이어그램 코드 입력 시 버튼 활성화
document.addEventListener('input', (e) => {
  if (e.target.id === 'gsheetUrl' && currentUploadTab === 'gsheet') {
    document.getElementById('uploadBtn').disabled = !e.target.value.trim();
  }
  if (e.target.id === 'diagramCode' && currentUploadTab === 'diagram') {
    document.getElementById('uploadBtn').disabled = !e.target.value.trim();
  }
});

// 다이어그램 파일 불러오기 → 코드 입력창에 내용 주입
document.addEventListener('change', (e) => {
  if (e.target.id !== 'diagramFileInput') return;
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('diagramCode').value = reader.result;
    const nameInput = document.getElementById('diagramName');
    if (!nameInput.value.trim()) nameInput.value = file.name.replace(/\.(mmd|mermaid|txt|md)$/i, '');
    if (currentUploadTab === 'diagram') {
      document.getElementById('uploadBtn').disabled = !reader.result.trim();
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ===== View Switching =====
function showView(viewId) {
  ['dashboard', 'projectView', 'reportViewer', 'searchView', 'runView'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== viewId);
  });
  if (viewId !== 'reportViewer') {
    setViewerFrameUrl('');
  }
}

// ===== Modal Helpers =====
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ===== Utilities =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// Enter키로 프로젝트 생성, Escape로 모달 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const newProjectModal = document.getElementById('newProjectModal');
    if (!newProjectModal.classList.contains('hidden')) {
      createProject();
    }
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
  }
});

// ===== Drag & Drop 순서 변경 =====
let draggedProjectId = null;

function onDragStart(e, id) {
  draggedProjectId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  setTimeout(() => {
    e.target.classList.add('dragging');
  }, 0);
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function onDragEnter(e) {
  e.preventDefault();
  const li = e.target.closest('.tree-item');
  if (li && li.dataset.id !== draggedProjectId) {
    li.classList.add('drag-over');
  }
}

function onDragLeave(e) {
  const li = e.target.closest('.tree-item');
  if (li) li.classList.remove('drag-over');
}

function onDrop(e, targetId) {
  e.preventDefault();
  const li = e.target.closest('.tree-item');
  if (li) li.classList.remove('drag-over');

  if (!draggedProjectId || draggedProjectId === targetId) {
    draggedProjectId = null;
    return;
  }

  // 같은 부모 레벨에서만 순서 변경
  const draggedNode = findProjectInTree(projectTree, draggedProjectId);
  const targetNode = findProjectInTree(projectTree, targetId);

  if (!draggedNode || !targetNode) { draggedProjectId = null; return; }

  const draggedParent = draggedNode.parentId || null;
  const targetParent = targetNode.parentId || null;

  if (draggedParent !== targetParent) {
    // 다른 부모면 무시 (같은 레벨끼리만 이동 가능)
    draggedProjectId = null;
    return;
  }

  // 해당 부모의 children 순서 재배치
  const siblings = getSiblings(projectTree, draggedParent);
  const draggedIdx = siblings.findIndex(p => p.id === draggedProjectId);
  const targetIdx = siblings.findIndex(p => p.id === targetId);

  if (draggedIdx === -1 || targetIdx === -1) { draggedProjectId = null; return; }

  // 순서 변경: dragged를 target 위치로 이동
  siblings.splice(draggedIdx, 1);
  const newTargetIdx = siblings.findIndex(p => p.id === targetId);
  siblings.splice(newTargetIdx + (draggedIdx < targetIdx ? 1 : 0), 0, draggedNode);

  // 서버에 새 순서 저장
  const orders = siblings.map((p, i) => ({ id: p.id, order: i }));
  saveProjectOrder(orders);

  draggedProjectId = null;
}

function getSiblings(tree, parentId) {
  if (!parentId) return tree;
  const parent = findProjectInTree(tree, parentId);
  return parent ? parent.children : [];
}

async function saveProjectOrder(orders) {
  await api('/api/projects/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orders })
  });
  await loadProjects();
}

document.addEventListener('dragend', (e) => {
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedProjectId = null;
});

// ===== Search =====
let searchTimeout = null;

function handleSearchKeyup(e) {
  const query = e.target.value.trim();

  if (e.key === 'Escape') {
    e.target.value = '';
    // 이전 화면으로 복귀
    if (currentProjectId) {
      navigateTo(`#project/${currentProjectId}`);
    } else {
      navigateTo('#');
    }
    return;
  }

  // 디바운스 300ms
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    if (query.length >= 2) {
      performSearch();
    } else if (query.length === 0) {
      if (currentProjectId) {
        navigateTo(`#project/${currentProjectId}`);
      } else {
        navigateTo('#');
      }
    }
  }, 300);
}

async function performSearch() {
  const query = document.getElementById('globalSearchInput').value.trim();
  if (query.length < 2) return;

  const scope = document.getElementById('searchScope').value;
  let url = `/api/search?q=${encodeURIComponent(query)}`;
  if (scope) url += `&projectId=${scope}`;

  const results = await api(url);
  showView('searchView');

  document.getElementById('searchTitle').textContent = `"${query}" 검색 결과 (${results.length}건)`;
  renderSearchResults(results, query);

  // 검색 스코프 셀렉트 업데이트
  updateSearchScope();
}

function updateSearchScope() {
  const select = document.getElementById('searchScope');
  const allProjects = flattenTree(projectTree);
  const currentValue = select.value;

  select.innerHTML = `<option value="">전체 프로젝트</option>` +
    allProjects.map(p => `<option value="${p.id}" ${p.id === currentValue ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
}

function renderSearchResults(results, query) {
  const container = document.getElementById('searchResults');

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>검색 결과가 없습니다</h3>
        <p>"${escapeHtml(query)}"에 해당하는 리포트를 찾을 수 없습니다.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = results.map(r => {
    const typeIcon = r.type === 'folder' ? '📂' : r.type === 'markdown' ? '📝' : r.type === 'diagram' ? '📈' : '📄';
    const snippetHtml = r.snippets && r.snippets.length > 0
      ? `<div class="search-snippets">${r.snippets.map(s => `<span class="snippet">${highlightKeywords(escapeHtml(s), query)}</span>`).join('')}</div>`
      : '';

    return `
      <div class="search-result-item" onclick="goToSearchResult('${r.projectId}', '${r.id}')">
        <div class="search-result-header">
          <span class="ri-icon">${typeIcon}</span>
          <div class="search-result-info">
            <div class="search-result-name">${highlightKeywords(escapeHtml(r.originalName), query)}</div>
            <div class="search-result-meta">
              <span class="search-project-badge">${escapeHtml(r.projectName)}</span>
              · ${r.date} · ${r.uploadedBy}
            </div>
          </div>
        </div>
        ${snippetHtml}
      </div>
    `;
  }).join('');
}

function highlightKeywords(text, query) {
  const keywords = query.toLowerCase().split(/\s+/);
  let result = text;
  for (const kw of keywords) {
    const regex = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  }
  return result;
}

function goToSearchResult(projectId, reportId) {
  currentProjectId = projectId;
  navigateTo(`#project/${projectId}/report/${reportId}`);
}

// ===== 테스트 수행 보드 (test-run R1) =====
// 진행 중 작업공간 — TC 행 × 거래소 축, 거래소당 자동🤖/수동✋/최종 3칸.
// 모든 기입은 서버 append-only 이벤트, 화면은 변경 셀(행)만 부분 패치 (침입 방지 원칙).
let runListData = [];
let currentRunId = null;
let currentRun = null;
let runStaleOnly = false;
let runSearchQ = '';

const RUN_RESULTS = ['Pass', 'Fail', 'Blocked', 'N/T', 'N/A'];

function exKeysOf(run) {
  return (run.exchanges && run.exchanges.length) ? run.exchanges : [''];
}

function exLabel(ex) {
  return ex || '결과';
}

// ── 사이드바 보드 목록 ──
async function loadRuns() {
  const list = await api('/api/runs');
  if (Array.isArray(list)) runListData = list;
  renderRunList();
}

function renderRunList() {
  const el = document.getElementById('runList');
  if (!el) return;
  if (!runListData.length) {
    el.innerHTML = '<li class="run-list-empty">아직 보드가 없습니다</li>';
    return;
  }
  el.innerHTML = runListData.map(r => {
    const s = r.summary || { filled: 0, total: 0, fail: 0 };
    const closed = r.status === 'closed';
    return `
      <li class="run-item ${r.id === currentRunId ? 'active' : ''} ${closed ? 'run-closed' : ''}" onclick="selectRun('${r.id}')">
        <span class="run-item-icon">${closed ? '🔒' : '🧪'}</span>
        <span class="tree-name">${escapeHtml(r.name)}</span>
        ${s.fail ? `<span class="run-fail-dot" title="Fail ${s.fail}건">${s.fail}</span>` : ''}
        <span class="report-count">${s.filled}/${s.total}</span>
      </li>`;
  }).join('');
}

function selectRun(id) {
  navigateTo(`#run/${id}`);
}

// ── 보드 화면 ──
async function showRunView(id) {
  showView('runView');
  const wrap = document.getElementById('runGridWrap');
  wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>보드를 불러오는 중…</p></div>';
  const data = await api(`/api/runs/${id}`);
  if (!data || data.error) {
    wrap.innerHTML = `<div class="empty-state"><p>${escapeHtml((data && data.error) || '보드를 불러오지 못했습니다.')}</p></div>`;
    return;
  }
  currentRun = data;
  runStaleOnly = false;
  runSearchQ = '';
  renderRunHeader();
  renderRunSummary();
  renderRunToolbar();
  renderRunGrid();
}

function renderRunHeader() {
  const r = currentRun;
  document.getElementById('runTitle').innerHTML = `
    <span class="editable-title" ondblclick="renameRun()">${escapeHtml(r.name)}</span>
    <button class="btn-edit-name" onclick="renameRun()" title="이름 수정">✏️</button>`;

  const stale = r.versionHistory && r.versionHistory.length
    ? `<span class="run-chip run-chip-hint" title="이전 버전: ${escapeHtml(r.versionHistory.map(v => v.version || '(미지정)').join(' → '))}">이력 ${r.versionHistory.length}</span>` : '';
  document.getElementById('runMeta').innerHTML = `
    ${r.snapshot ? `<span class="run-chip" title="테스트 주기 (불변)">📅 ${escapeHtml(r.snapshot)}</span>` : ''}
    <span class="run-chip run-chip-version" onclick="changeRunVersion()" title="클릭하여 대상 버전 변경 — 기존 결과는 유지되고 ⚠ 재검 배지가 붙습니다">🏷 ${escapeHtml(r.targetVersion || '버전 미지정')}</span>
    ${stale}
    <span class="run-chip">${r.exchanges && r.exchanges.length ? escapeHtml(r.exchanges.join(' · ')) : '거래소 축 없음'}</span>
    ${r.status === 'closed' ? '<span class="run-chip run-chip-closed">🔒 닫힘</span>' : ''}
    ${publishedChip(r)}`;

  // 발행 정책(2026-07-23 개정): 미발행 = 신규 프로젝트 생성 발행 / 발행됨 = 연결된 곳으로만 재발행
  // + 새 프로젝트로 다시 발행 가능. 기존 프로젝트 선택 경로는 없음(오발송 방지).
  const publishBtns = r.publishedTo
    ? `<button class="btn btn-primary" onclick="republishRun()" title="연결된 결과 대시보드에 현재 보드 상태를 반영합니다 (이전 반영분 교체)">📊 대시보드 갱신</button>
       <button class="btn btn-secondary" onclick="openPublishRunModal()" title="결과 대시보드를 새로 하나 더 만듭니다 — 갱신 연결이 새 대시보드로 이동합니다">새 대시보드 만들기…</button>`
    : `<button class="btn btn-primary" onclick="openPublishRunModal()" title="보드의 최종 결과로 취합 대시보드(결과형 프로젝트)를 만듭니다">📊 결과 대시보드 만들기</button>`;
  document.getElementById('runActions').innerHTML = `
    ${publishBtns}
    <button class="btn btn-secondary" onclick="toggleRunStatus()">${r.status === 'closed' ? '보드 다시 열기' : '보드 닫기'}</button>
    <button class="btn btn-danger-outline" onclick="deleteRun()">🗑 삭제</button>`;
}

// ── 결과형으로 발행 (R3 — A안) ──
// 발행 이후 기입분은 재발행으로 갱신 — 칩으로 발행 시각을 보여 재발행 필요를 알린다
function publishedChip(r) {
  if (!r.publishedTo) return '';
  const p = findProjectInTree(projectTree, r.publishedTo.projectId);
  const name = p ? p.name : '(삭제된 프로젝트)';
  const chip = `📊 결과 대시보드: ${escapeHtml(name)} · ${formatTime(r.publishedTo.at)} 반영`;
  return p
    ? `<span class="run-chip run-chip-version" onclick="selectProject('${p.id}')" title="결과 대시보드 열기">${chip}</span>`
    : `<span class="run-chip run-chip-hint">${chip}</span>`;
}

// 폴더 위치 옵션 — 최상위 + 깊이 2 미만 노드(새 프로젝트가 3단계를 넘지 않도록)
function publishParentOptions() {
  const opts = ['<option value="">(최상위)</option>'];
  const walk = (nodes, depth, prefix) => {
    for (const n of nodes || []) {
      if (depth < 2) opts.push(`<option value="${n.id}">${prefix}${escapeHtml(n.name)}</option>`);
      if (n.children) walk(n.children, depth + 1, prefix + '· ');
    }
  };
  walk(projectTree, 0, '');
  return opts.join('');
}

function openPublishRunModal() {
  document.getElementById('publishName').value = currentRun.name;
  document.getElementById('publishParentSelect').innerHTML = publishParentOptions();
  openModal('publishRunModal');
  setTimeout(() => document.getElementById('publishName').focus(), 100);
}

async function callPublish(body) {
  const d = await api(`/api/runs/${currentRun.id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!d || d.error) { showToast('❌ ' + ((d && d.error) || '발행 실패'), 'error'); return null; }
  currentRun.publishedTo = { projectId: d.projectId, at: new Date().toISOString(), sourceId: d.sourceId };
  return d;
}

// 신규 발행 — 새 결과형 프로젝트 생성 + 발행 (모달)
async function publishRun() {
  const name = document.getElementById('publishName').value.trim();
  if (!name) { showToast('프로젝트 이름을 입력해 주세요.', 'error'); return; }
  const btn = document.getElementById('publishRunBtn');
  btn.disabled = true;
  btn.textContent = '발행 중...';
  try {
    const d = await callPublish({ mode: 'new', name, parentId: document.getElementById('publishParentSelect').value || null });
    if (!d) return;
    closeModal('publishRunModal');
    await loadProjects(); // 사이드바에 새 결과형 프로젝트 반영
    renderRunHeader();
    showToast(`✅ 결과 대시보드 생성 완료 — "${name}" · ${d.rowCount}행 반영`, 'success');
  } finally {
    btn.disabled = false;
    btn.textContent = '대시보드 만들기';
  }
}

// 재발행 — 연결된 프로젝트로 원클릭 (이전 발행분 교체)
async function republishRun() {
  const d = await callPublish({ mode: 'republish' });
  if (!d) return;
  renderRunHeader();
  showToast(`✅ 결과 대시보드 갱신 완료 — ${d.rowCount}행 반영 (이전 반영분 교체)`, 'success');
}

function renderRunSummary() {
  const s = currentRun.summary || { total: 0, filled: 0, fail: 0, perExchange: {} };
  const pct = s.total ? Math.round(s.filled / s.total * 100) : 0;
  const exs = exKeysOf(currentRun);
  const perEx = exs.map(ex => {
    const e = (s.perExchange && s.perExchange[ex]) || { total: 0, filled: 0, fail: 0 };
    const p = e.total ? Math.round(e.filled / e.total * 100) : 0;
    return `<span class="run-sum-ex">${escapeHtml(exLabel(ex))} <b>${p}%</b>${e.fail ? ` <i class="run-sum-fail">F${e.fail}</i>` : ''}</span>`;
  }).join('');
  document.getElementById('runSummary').innerHTML = `
    <div class="run-sum-band">
      <span class="run-sum-main">진행 <b>${s.filled}</b>/${s.total} (${pct}%)</span>
      <span class="run-sum-main ${s.fail ? 'run-sum-fail' : ''}">Fail <b>${s.fail}</b></span>
      <span class="run-sum-sep"></span>
      ${perEx}
    </div>`;
}

function renderRunToolbar() {
  document.getElementById('runToolbar').innerHTML = `
    <input type="text" class="form-input run-search" placeholder="🔍 TC ID·제목 필터" value="${escapeHtml(runSearchQ)}"
      oninput="runSearchQ = this.value; renderRunGrid();">
    <label class="run-stale-toggle" title="현재 대상 버전 이전에 기록된 결과만 표시">
      <input type="checkbox" ${runStaleOnly ? 'checked' : ''} onchange="runStaleOnly = this.checked; renderRunGrid();"> ⚠ 재검 필요만
    </label>
    <span class="run-tc-count">${(currentRun.tcs || []).length} TC</span>`;
}

// 구버전 스탬프 여부 — 결정값(Pass/Fail/Blocked/N/A)이 현재 대상 버전 이전 기록이면 재검 대상
function isStaleEntry(entry) {
  return !!(entry && entry.result && entry.result !== 'N/T' && entry.version
    && currentRun.targetVersion && entry.version !== currentRun.targetVersion);
}

function cellHasStale(cell) {
  return isStaleEntry(cell.auto) || isStaleEntry(cell.manual)
    || (cell.final && cell.final.source === 'confirmed' && isStaleEntry(cell.final));
}

function runRowVisible(tc) {
  if (runSearchQ) {
    const q = runSearchQ.toLowerCase();
    const hay = `${tc.tcId} ${tc.title || ''} ${tc.category1 || ''} ${tc.category2 || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (runStaleOnly) {
    return exKeysOf(currentRun).some(ex => tc.cells[ex] && cellHasStale(tc.cells[ex]));
  }
  return true;
}

function runResBadge(result, opts = {}) {
  if (!result) return '<span class="run-empty">—</span>';
  const stale = opts.stale ? ` <span class="run-stale" title="이전 버전(${escapeHtml(opts.version || '')}) 기록 — 재검 필요">⚠</span>` : '';
  const title = opts.version ? ` title="@${escapeHtml(opts.version)}"` : '';
  return `<span class="res-badge res-${String(result).replace('/', '')}"${title}>${escapeHtml(result)}</span>${stale}`;
}

function runPrioChip(p) {
  if (!p) return '<span class="run-empty">—</span>';
  return `<span class="run-prio run-prio-${p.toLowerCase()}">${p}</span>`;
}

function runAutomationBadge(tc) {
  if (tc.coveragePct != null) {
    return `<span class="run-cov" title="${escapeHtml(tc.automation || '')} ${escapeHtml(tc.coverageNote || '')}">🤖 ${tc.coveragePct}%</span>`;
  }
  if (tc.automation) return `<span class="run-cov run-cov-dim" title="Coverage % 미기재">🤖 ${escapeHtml(tc.automation)}</span>`;
  return '<span class="run-empty">—</span>';
}

// 수동 칸 — 드롭다운 (Pass/Fail/Blocked/N/T/N/A, 취합과 동일 어휘)
function runManualSelect(tci, exi, cell, disabled) {
  const cur = cell.manual && cell.manual.result || '';
  const cls = cur ? ` res-${cur.replace('/', '')}` : '';
  const stale = isStaleEntry(cell.manual)
    ? `<span class="run-stale" title="이전 버전(${escapeHtml(cell.manual.version || '')}) 기록 — 재검 필요">⚠</span>` : '';
  const opts = [`<option value="" disabled hidden ${cur ? '' : 'selected'}>—</option>`]
    .concat(RUN_RESULTS.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`)).join('');
  const tip = cell.manual ? ` title="${escapeHtml(cell.manual.by || '')} · ${formatTime(cell.manual.at)}${cell.manual.version ? ' · @' + escapeHtml(cell.manual.version) : ''}"` : '';
  return `<select class="run-select${cls}" data-tci="${tci}" data-exi="${exi}" data-slot="manual" ${disabled ? 'disabled' : ''}${tip}>${opts}</select>${stale}`;
}

// 최종 칸 — 기본은 자동 파생(⚙), 사람이 덮어쓰면 확정(👤). 해제하면 파생으로 복귀.
function runFinalSelect(tci, exi, cell, disabled) {
  const fin = cell.final || { result: 'N/T', source: 'derived' };
  const confirmed = fin.source === 'confirmed';
  const cls = ` res-${String(fin.result).replace('/', '')}`;
  const derivedLabel = confirmed ? '↺ 자동 파생으로' : `⚙ ${fin.result}`;
  const opts = [`<option value="" ${confirmed ? '' : 'selected'}>${derivedLabel}</option>`]
    .concat(RUN_RESULTS.map(v => `<option value="${v}" ${confirmed && v === fin.result ? 'selected' : ''}>👤 ${v}</option>`)).join('');
  const badge = fin.badge ? `<span class="run-progress-badge" title="부분 커버리지 자동 통과 — 수동 검증 필요">${escapeHtml(fin.badge)}</span>` : '';
  const stale = confirmed && isStaleEntry(fin)
    ? `<span class="run-stale" title="이전 버전(${escapeHtml(fin.version || '')}) 확정 — 재검 필요">⚠</span>` : '';
  const tip = confirmed ? ` title="수동 확정: ${escapeHtml(fin.by || '')} · ${formatTime(fin.at)}"` : ' title="자동 파생 — 드롭다운으로 수동 확정 가능"';
  return `<select class="run-select run-select-final${cls} ${confirmed ? 'run-confirmed' : ''}" data-tci="${tci}" data-exi="${exi}" data-slot="final" ${disabled ? 'disabled' : ''}${tip}>${opts}</select>${badge}${stale}`;
}

function runCellsHtml(tci, tc) {
  const exs = exKeysOf(currentRun);
  const closed = currentRun.status === 'closed';
  return exs.map((ex, exi) => {
    // 대상 거래소가 명시된 TC 는 대상 외 셀 비활성 (plan §TC 양식)
    if (ex && tc.targetExchanges && tc.targetExchanges.length && !tc.targetExchanges.includes(ex)) {
      return '<td class="run-cell run-cell-off" colspan="3" title="대상 거래소 아님">—</td>';
    }
    const cell = tc.cells[ex] || { auto: null, manual: null, final: { result: 'N/T', source: 'derived' }, events: 0 };
    const autoHtml = runResBadge(cell.auto && cell.auto.result, {
      stale: isStaleEntry(cell.auto), version: cell.auto && cell.auto.version,
    });
    const memoCls = cell.events ? 'run-memo has-memo' : 'run-memo';
    return `
      <td class="run-cell run-cell-auto">${autoHtml}</td>
      <td class="run-cell">${runManualSelect(tci, exi, cell, closed)}</td>
      <td class="run-cell run-cell-final">${runFinalSelect(tci, exi, cell, closed)}
        <button class="${memoCls}" data-tci="${tci}" data-exi="${exi}" title="메모·이력">💬${cell.events || ''}</button>
      </td>`;
  }).join('');
}

function runRowHtml(tci) {
  const tc = currentRun.tcs[tci];
  return `
    <td class="run-tc" data-tci="${tci}" title="클릭하여 사전조건·스텝·기대결과 열기">
      <span class="run-tc-id">${escapeHtml(tc.tcId)}</span>
      ${tc.smoke ? '<span class="run-smoke" title="smoke">🔥</span>' : ''}
      <div class="run-tc-title">${escapeHtml(tc.title || '')}</div>
    </td>
    <td class="run-cell-prio">${runPrioChip(tc.priority)}</td>
    <td class="run-cell-autocov">${runAutomationBadge(tc)}</td>
    ${runCellsHtml(tci, tc)}`;
}

function renderRunGrid() {
  const wrap = document.getElementById('runGridWrap');
  const exs = exKeysOf(currentRun);
  const colCount = 3 + exs.length * 3;

  const exHead1 = exs.map(ex => `<th colspan="3" class="run-ex-head">${escapeHtml(exLabel(ex))}</th>`).join('');
  const exHead2 = exs.map(() => '<th class="run-sub-head">자동 🤖</th><th class="run-sub-head">수동 ✋</th><th class="run-sub-head">최종</th>').join('');

  let body = '';
  let lastGroup = null;
  let visible = 0;
  (currentRun.tcs || []).forEach((tc, tci) => {
    if (!runRowVisible(tc)) return;
    visible++;
    const group = [tc.category1, tc.category2].filter(Boolean).join(' › ');
    if (group && group !== lastGroup) {
      body += `<tr class="run-group"><td colspan="${colCount}">${escapeHtml(group)}</td></tr>`;
      lastGroup = group;
    }
    body += `<tr class="run-row" data-tci="${tci}">${runRowHtml(tci)}</tr>`;
  });

  if (!visible) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">${runStaleOnly ? '✅' : '🔍'}</div><p>${runStaleOnly ? '재검이 필요한 TC 가 없습니다.' : '조건에 맞는 TC 가 없습니다.'}</p></div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="run-grid-scroll">
      <table class="cons-table run-grid">
        <thead>
          <tr>
            <th rowspan="2" class="run-th-tc">TC</th>
            <th rowspan="2">중요도</th>
            <th rowspan="2" title="자동화 커버리지 (TC 양식)">자동화</th>
            ${exHead1}
          </tr>
          <tr>${exHead2}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// ── 셀 기입 (이벤트 위임) ──
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('select.run-select');
  if (!sel || !currentRun) return;
  const tci = Number(sel.dataset.tci);
  const exi = Number(sel.dataset.exi);
  const slot = sel.dataset.slot;
  const tc = currentRun.tcs[tci];
  const ex = exKeysOf(currentRun)[exi];
  if (!tc) return;

  // 낙관적 반영은 select 자체가 이미 함 — 서버 확정 후 행 부분 패치
  const resp = await api(`/api/runs/${currentRun.id}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcId: tc.tcId, exchange: ex, kind: 'result', slot, result: sel.value || null }),
  });
  if (!resp || resp.error) {
    showToast('❌ ' + ((resp && resp.error) || '기입 실패'), 'error');
    patchRunRow(tci); // 서버 상태(기존 값)로 되돌림
    return;
  }
  tc.cells[ex] = resp.cell;
  currentRun.summary = resp.summary;
  patchRunRow(tci, true);
  renderRunSummary();
  refreshRunListItem();
});

// 변경 행만 부분 패치 — 전체 재렌더·스크롤 이동 없음 (침입 방지 원칙 1·4)
function patchRunRow(tci, flash) {
  const tr = document.querySelector(`#runGridWrap tr.run-row[data-tci="${tci}"]`);
  if (!tr) return;
  tr.innerHTML = runRowHtml(tci);
  if (flash) {
    tr.classList.add('run-flash');
    setTimeout(() => tr.classList.remove('run-flash'), 900);
  }
}

// 사이드바 목록의 현재 보드 통계만 동기화
function refreshRunListItem() {
  const item = runListData.find(r => r.id === currentRun.id);
  if (item) { item.summary = currentRun.summary; renderRunList(); }
}

// ── TC 상세 확장 + 메모 팝오버 (클릭 위임) ──
document.addEventListener('click', (e) => {
  const memoBtn = e.target.closest('button.run-memo');
  if (memoBtn && currentRun) {
    e.stopPropagation();
    openCellMemo(Number(memoBtn.dataset.tci), Number(memoBtn.dataset.exi), memoBtn);
    return;
  }
  const tcCell = e.target.closest('td.run-tc');
  if (tcCell && currentRun) {
    toggleRunDetail(Number(tcCell.dataset.tci), tcCell.closest('tr'));
    return;
  }
  // 팝오버 밖 클릭 → 닫기
  if (!e.target.closest('#runMemoPopover')) closeCellMemo();
});

function toggleRunDetail(tci, tr) {
  const existing = tr.nextElementSibling;
  if (existing && existing.classList.contains('run-detail') && existing.dataset.tci === String(tci)) {
    existing.remove();
    return;
  }
  document.querySelectorAll('#runGridWrap tr.run-detail').forEach(el => el.remove());
  const tc = currentRun.tcs[tci];
  const colCount = 3 + exKeysOf(currentRun).length * 3;
  const block = (label, v) => v ? `<div class="run-doc-block"><b>${label}</b><pre>${escapeHtml(v)}</pre></div>` : '';
  const metaBits = [
    tc.screenCode ? `화면코드 ${escapeHtml(tc.screenCode)}` : '',
    tc.programIds ? `Program IDs ${escapeHtml(tc.programIds)}` : '',
    tc.automation ? `자동화 ${escapeHtml(tc.automation)}` : '',
    tc.coverageNote ? `Coverage 메모: ${escapeHtml(tc.coverageNote)}` : '',
  ].filter(Boolean).join(' · ');
  tr.insertAdjacentHTML('afterend', `
    <tr class="run-detail" data-tci="${tci}"><td colspan="${colCount}">
      ${block('사전조건', tc.precondition)}
      ${block('테스트 스텝', tc.steps)}
      ${block('기대결과', tc.expected)}
      ${metaBits ? `<div class="run-doc-meta">${metaBits}</div>` : ''}
      ${!tc.precondition && !tc.steps && !tc.expected && !metaBits ? '<div class="run-doc-meta">문서 컬럼이 없습니다.</div>' : ''}
    </td></tr>`);
}

// ── 셀 메모/이력 팝오버 ──
let memoCtx = null; // { tci, exi }

async function openCellMemo(tci, exi, anchor) {
  closeCellMemo();
  memoCtx = { tci, exi };
  const tc = currentRun.tcs[tci];
  const ex = exKeysOf(currentRun)[exi];

  const pop = document.createElement('div');
  pop.id = 'runMemoPopover';
  pop.innerHTML = `
    <div class="memo-head">💬 ${escapeHtml(tc.tcId)}${ex ? ' · ' + escapeHtml(ex) : ''}
      <button class="modal-close" onclick="closeCellMemo()">✕</button></div>
    <div class="memo-thread" id="memoThread"><div class="run-empty">불러오는 중…</div></div>
    ${currentRun.status === 'closed' ? '' : `
    <div class="memo-input">
      <textarea id="memoText" rows="2" placeholder="메모 입력…"></textarea>
      <button class="btn btn-primary btn-sm" onclick="saveCellMemo()">저장</button>
    </div>`}`;
  document.body.appendChild(pop);

  // 앵커(💬 버튼) 기준 위치 — 화면 밖으로 나가지 않게 보정
  const r = anchor.getBoundingClientRect();
  const W = 340;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - W - 8, r.right - W)) + 'px';
  pop.style.top = Math.min(window.innerHeight - 60, r.bottom + 6) + 'px';

  await reloadMemoThread();
  const ta = document.getElementById('memoText');
  if (ta) ta.focus();
}

async function reloadMemoThread() {
  if (!memoCtx) return;
  const tc = currentRun.tcs[memoCtx.tci];
  const ex = exKeysOf(currentRun)[memoCtx.exi];
  const d = await api(`/api/runs/${currentRun.id}/cell-events?tcId=${encodeURIComponent(tc.tcId)}&exchange=${encodeURIComponent(ex)}`);
  const el = document.getElementById('memoThread');
  if (!el) return;
  const events = (d && d.events) || [];
  if (!events.length) {
    el.innerHTML = '<div class="run-empty">아직 기록이 없습니다.</div>';
    return;
  }
  const slotName = { auto: '자동 🤖', manual: '수동 ✋', final: '최종' };
  el.innerHTML = events.map(ev => {
    const meta = `<span class="memo-meta">${escapeHtml(ev.by || '')} · ${formatTime(ev.at)}${ev.version ? ' · @' + escapeHtml(ev.version) : ''}</span>`;
    if (ev.kind === 'note') {
      return `<div class="memo-item memo-note"><div class="memo-text">${escapeHtml(ev.text)}</div>${meta}</div>`;
    }
    // 값 변경 이력 = 시스템 항목 (확정 결정: 이력은 메모 스레드에 자동 기록)
    const what = ev.result
      ? `${slotName[ev.slot] || ev.slot} <b class="res-badge res-${String(ev.result).replace('/', '')}">${escapeHtml(ev.result)}</b> 기입`
      : `${slotName[ev.slot] || ev.slot} 확정 해제 (자동 파생으로 복귀)`;
    return `<div class="memo-item memo-system"><div class="memo-text">${what}</div>${meta}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function saveCellMemo() {
  const ta = document.getElementById('memoText');
  if (!ta || !ta.value.trim() || !memoCtx) return;
  const tc = currentRun.tcs[memoCtx.tci];
  const ex = exKeysOf(currentRun)[memoCtx.exi];
  const resp = await api(`/api/runs/${currentRun.id}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tcId: tc.tcId, exchange: ex, kind: 'note', text: ta.value.trim() }),
  });
  if (!resp || resp.error) {
    showToast('❌ ' + ((resp && resp.error) || '메모 저장 실패'), 'error');
    return;
  }
  ta.value = '';
  tc.cells[ex] = resp.cell;
  currentRun.summary = resp.summary;
  patchRunRow(memoCtx.tci);
  await reloadMemoThread();
}

function closeCellMemo() {
  const pop = document.getElementById('runMemoPopover');
  if (pop) pop.remove();
  memoCtx = null;
}

// ── 보드 관리 (이름·버전·상태·삭제) ──
async function renameRun() {
  const name = prompt('보드 이름', currentRun.name);
  if (!name || !name.trim() || name.trim() === currentRun.name) return;
  const d = await api(`/api/runs/${currentRun.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!d || d.error) { showToast('❌ ' + ((d && d.error) || '수정 실패'), 'error'); return; }
  currentRun.name = d.name;
  renderRunHeader();
  loadRuns();
}

async function changeRunVersion() {
  const v = prompt('대상 버전 (현재 테스트 대상 빌드)\n변경해도 기존 결과는 유지되고, 구버전 기록에 ⚠ 재검 배지가 붙습니다.', currentRun.targetVersion || '');
  if (v === null) return;
  const d = await api(`/api/runs/${currentRun.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetVersion: v }),
  });
  if (!d || d.error) { showToast('❌ ' + ((d && d.error) || '수정 실패'), 'error'); return; }
  // 배지·요약이 버전 기준으로 바뀌므로 보드 재조회
  await showRunView(currentRun.id);
  showToast('🏷 대상 버전이 변경되었습니다. 구버전 기록은 ⚠ 재검 배지로 표시됩니다.', 'success');
}

async function toggleRunStatus() {
  const toClosed = currentRun.status !== 'closed';
  if (toClosed && !confirm('보드를 닫을까요? 닫힌 보드는 기입할 수 없습니다. (다시 열기 가능)')) return;
  const d = await api(`/api/runs/${currentRun.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: toClosed ? 'closed' : 'active' }),
  });
  if (!d || d.error) { showToast('❌ ' + ((d && d.error) || '변경 실패'), 'error'); return; }
  await showRunView(currentRun.id);
  loadRuns();
}

async function deleteRun() {
  if (!confirm('이 수행 보드와 모든 기입 이력을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
  await api(`/api/runs/${currentRun.id}`, { method: 'DELETE' });
  currentRunId = null;
  currentRun = null;
  await loadRuns();
  navigateTo('#');
}

// ── 새 보드 생성 모달 ──
let runSelectedFile = null;

function openNewRunModal() {
  runSelectedFile = null;
  ['runName', 'runGsheetUrl', 'runSnapshot', 'runTargetVersion', 'runExchanges'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('runFileLabel').textContent = '📋 TC 양식 파일을 드래그하거나 클릭하여 선택';
  const zone = document.getElementById('runFileZone');
  if (!zone.dataset.bound) {
    zone.dataset.bound = '1';
    const input = document.getElementById('runFileInput');
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => setRunFile(input.files[0]));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) setRunFile(e.dataTransfer.files[0]);
    });
  }
  openModal('newRunModal');
  setTimeout(() => document.getElementById('runName').focus(), 100);
}

function setRunFile(file) {
  if (!file) return;
  runSelectedFile = file;
  document.getElementById('runFileLabel').textContent = `📋 ${file.name}`;
  // 파일명으로 보드 이름 기본값 제안
  const nameInput = document.getElementById('runName');
  if (!nameInput.value.trim()) nameInput.value = file.name.replace(/\.(xlsx|xls|csv)$/i, '');
}

async function createRun() {
  const name = document.getElementById('runName').value.trim();
  const gsheetUrl = document.getElementById('runGsheetUrl').value.trim();
  if (!name) { showToast('보드 이름을 입력해 주세요.', 'error'); return; }
  if (!runSelectedFile && !gsheetUrl) { showToast('TC 양식 파일 또는 Google Sheets URL 을 입력해 주세요.', 'error'); return; }

  const fd = new FormData();
  fd.append('name', name);
  fd.append('snapshot', document.getElementById('runSnapshot').value.trim());
  fd.append('targetVersion', document.getElementById('runTargetVersion').value.trim());
  fd.append('exchanges', document.getElementById('runExchanges').value.trim());
  if (runSelectedFile) fd.append('file', runSelectedFile);
  else fd.append('gsheetUrl', gsheetUrl);

  const btn = document.getElementById('createRunBtn');
  btn.disabled = true;
  btn.textContent = '생성 중...';
  try {
    const d = await api('/api/runs', { method: 'POST', body: fd });
    if (!d || d.error) { showToast('❌ ' + ((d && d.error) || '보드 생성 실패'), 'error'); return; }
    closeModal('newRunModal');
    showToast(`✅ 보드 생성 완료 — TC ${d.tcCount}건`, 'success');
    await loadRuns();
    selectRun(d.id);
  } finally {
    btn.disabled = false;
    btn.textContent = '보드 생성';
  }
}
