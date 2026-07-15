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

// ===== QA 통합 — 9-dot 앱 런처 (INTEGRATION_SPEC §6.2 앱 레지스트리, 단일 소스) =====
let QA_CONFIG = null; // { integrated, tcgenUrl }
const QA_CURRENT_APP = 'tr';

async function initQaLauncher() {
  QA_CONFIG = await api('/api/config');
  if (QA_CONFIG && QA_CONFIG.integrated) {
    const btn = document.getElementById('launcherBtn');
    if (btn) btn.style.display = 'inline-flex';
  }
}

function qaApps() {
  const tcUrl = (QA_CONFIG && QA_CONFIG.tcgenUrl) || 'http://localhost:5001';
  return [
    { id: 'tc', name: 'Test Case Generator', desc: '기획서 → TC 자동 생성 · 갱신', color: '#3B5BDB', url: tcUrl },
    { id: 'tr', name: 'Test Result Portal',  desc: '테스트 결과 리포트 관리',      color: '#0F9D58', url: '/' },
    // 새 도구는 여기에 한 줄 추가
  ];
}

function toggleLauncher(e) {
  if (e) e.stopPropagation();
  if (document.getElementById('launcherMenu')) { closeLauncher(); return; }
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
    if (appDef.id === QA_CURRENT_APP) {
      const cur = document.createElement('span');
      cur.className = 'curmark';
      cur.style.color = appDef.color;
      cur.textContent = '● 사용 중';
      b.appendChild(cur);
    } else {
      b.onclick = () => { window.location.href = appDef.url; };
    }
    wrap.appendChild(b);
  });
  m.appendChild(wrap);
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
    renderProjectList();

    if (parts[2] === 'report' && parts[3]) {
      loadAndShowReport(projectId, parts[3]);
    } else {
      showProjectView(projectId);
    }
  } else {
    currentProjectId = null;
    renderProjectList();
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

  const grouped = await api(`/api/projects/${id}/reports`);
  renderDateGroups(grouped);
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
            const typeIcon = r.type === 'folder' ? '📂' : r.type === 'markdown' ? '📝' : r.type === 'gsheet' ? '📊' : '📄';
            const typeBadge = r.type === 'folder' ? '<span class="type-badge">ZIP</span>' 
              : r.type === 'markdown' ? '<span class="type-badge md">MD</span>'
              : r.type === 'gsheet' ? '<span class="type-badge gsheet">Sheets</span>' : '';
            const dashBtn = (r.type === 'gsheet' || r.type === 'single' || r.type === 'markdown' || r.type === 'folder')
              ? `<button class="btn-icon-sm" onclick="event.stopPropagation(); toggleDashboard('${r.id}', '${r.type}')" title="대시보드">📊</button>` : '';
            const refreshBtn = r.type === 'gsheet' 
              ? `<button class="btn-icon-sm" onclick="event.stopPropagation(); refreshReport('${r.id}')" title="최신 데이터로 새로고침">🔄</button>` : '';
            return `
            <div class="report-item" onclick="viewReport('${r.id}', '${escapeAttr(r.indexPath)}', '${escapeAttr(r.originalName)}')">
              <span class="ri-icon">${typeIcon}</span>
              <div class="ri-info">
                <div class="ri-name">${escapeHtml(r.originalName)} ${typeBadge}</div>
                <div class="ri-meta">${r.uploadedBy} · ${formatTime(r.uploadedAt)}${r.lastRefreshedAt ? ' · 🔄 ' + formatTime(r.lastRefreshedAt) : ''}</div>
              </div>
              <div class="ri-actions">
                ${dashBtn}
                ${refreshBtn}
                <button class="btn-icon-sm" onclick="event.stopPropagation(); openReportDirect('${escapeAttr(r.indexPath)}')" title="새 탭에서 열기">↗</button>
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
    if (report.type === 'markdown') {
      currentReportUrl = `/api/reports/${report.id}/render`;
    } else {
      currentReportUrl = `/uploads/${report.indexPath}`;
    }
    document.getElementById('viewerTitle').textContent = report.originalName;
    document.getElementById('viewerFrame').src = currentReportUrl;
    showView('reportViewer');
  } else {
    navigateTo(`#project/${projectId}`);
  }
}

function goBackToProject() {
  document.getElementById('viewerFrame').src = '';
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

function openReportDirect(indexPath) {
  window.open(`/uploads/${indexPath}`, '_blank');
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

  const formData = new FormData();
  for (const f of selectedFiles) {
    formData.append('files', f);
  }
  formData.append('date', document.getElementById('uploadDate').value);

  const uploaderName = document.getElementById('uploaderName').value.trim() || '익명';
  formData.append('uploadedBy', uploaderName);
  localStorage.setItem('uploaderName', uploaderName);

  try {
    await fetch(`/api/projects/${currentProjectId}/reports`, {
      method: 'POST',
      body: formData
    });

    selectedFiles = [];
    renderFileList();
    closeModal('uploadModal');
    hideLoadingOverlay();
    showToast('✅ 업로드 완료', 'success');
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

  // Fail 항목 리스트
  const failHtml = stats.failItems.length > 0 ? `
    <div class="dash-section">
      <div class="dash-section-title">❌ Fail 항목 (${stats.fail}건)</div>
      <div class="dash-fail-list">
        ${stats.failItems.map(item => `
          <div class="dash-fail-item">
            <span class="dash-fail-sheet">${escapeHtml(item.sheet)}</span>
            <span class="dash-fail-cells">${item.cells.map(c => escapeHtml(c)).join(' → ')}</span>
          </div>
        `).join('')}
      </div>
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
      ${sheetsHtml}
      ${failHtml}
      ${aiOn ? renderAiSection(reportId) : ''}
    </div>
  `;
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
  const chips = AI_PRESET_QUESTIONS.map(p =>
    `<button type="button" class="ai-chip" data-q="${escapeAttr(p.q)}" onclick="sendAiQuestion('${reportId}', this.dataset.q)">${escapeHtml(p.label)}</button>`
  ).join('');
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
            onkeydown="if(event.key==='Enter'){sendAiQuestion('${reportId}');}">
          <button type="button" class="btn btn-primary btn-sm" id="ai-send-${reportId}" onclick="sendAiQuestion('${reportId}')">전송</button>
        </div>
      </div>
    </div>`;
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
    const resp = await fetch(`/api/reports/${reportId}/chat`, {
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
    <button type="button" class="ai-pin" onclick="pinAiMetric('${reportId}', '${token}', this)">📌 대시보드에 추가</button>`;
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
  const body = { name, visibility: isPrivate ? 'private' : 'public' };
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
  switchUploadTab('file');
  openModal('uploadModal');
}

let currentUploadTab = 'file';

function switchUploadTab(tab) {
  currentUploadTab = tab;
  document.querySelectorAll('.upload-tab').forEach((el, i) => {
    el.classList.toggle('active', (i === 0 && tab === 'file') || (i === 1 && tab === 'gsheet'));
  });
  document.getElementById('uploadTabFile').classList.toggle('active', tab === 'file');
  document.getElementById('uploadTabGsheet').classList.toggle('active', tab === 'gsheet');

  // 버튼 텍스트/활성화 변경
  const btn = document.getElementById('uploadBtn');
  if (tab === 'gsheet') {
    btn.textContent = '가져오기';
    btn.onclick = importGoogleSheet;
    const url = document.getElementById('gsheetUrl').value.trim();
    btn.disabled = !url;
  } else {
    btn.textContent = '업로드';
    btn.onclick = uploadFiles;
    btn.disabled = selectedFiles.length === 0;
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
        uploadedBy: uploaderName
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

// gsheet URL 입력 시 버튼 활성화
document.addEventListener('input', (e) => {
  if (e.target.id === 'gsheetUrl' && currentUploadTab === 'gsheet') {
    document.getElementById('uploadBtn').disabled = !e.target.value.trim();
  }
});

// ===== View Switching =====
function showView(viewId) {
  ['dashboard', 'projectView', 'reportViewer', 'searchView'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== viewId);
  });
  if (viewId !== 'reportViewer') {
    document.getElementById('viewerFrame').src = '';
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
    const typeIcon = r.type === 'folder' ? '📂' : r.type === 'markdown' ? '📝' : '📄';
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
