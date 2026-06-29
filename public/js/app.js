// ===== State =====
let projectTree = [];
let currentProjectId = null;
let currentReportUrl = null;
let selectedFiles = [];

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  setupUploadZone();

  document.getElementById('uploadDate').value = new Date().toISOString().slice(0, 10);

  const savedName = localStorage.getItem('uploaderName');
  if (savedName) document.getElementById('uploaderName').value = savedName;

  // 브라우저 뒤로가기/앞으로가기
  window.addEventListener('popstate', () => handleNavigation());

  // 프로젝트 로드 후 URL 기반으로 초기 화면
  loadProjects().then(() => handleNavigation());
});

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
          <span class="tree-name">${escapeHtml(p.name)}</span>
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
              ? `<button class="btn-icon-sm" onclick="event.stopPropagation(); toggleDashboard('${r.id}')" title="대시보드">📊</button>` : '';
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
  if (currentProjectId) {
    navigateTo(`#project/${currentProjectId}`);
  } else {
    navigateTo('#');
  }
}

function openReportNewTab() {
  if (currentReportUrl) window.open(currentReportUrl, '_blank');
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
async function toggleDashboard(reportId) {
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

    el.innerHTML = renderDashboardPanel(stats);
  } catch (e) {
    el.innerHTML = '<div class="dashboard-empty">통계 추출에 실패했습니다.</div>';
  }
}

function renderDashboardPanel(stats) {
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
          <div class="dash-count total"><span class="dash-count-value">${stats.total}</span><span class="dash-count-label">Total</span></div>
        </div>
      </div>
      ${sheetsHtml}
      ${failHtml}
    </div>
  `;
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

  const body = { name };
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
  checkGoogleStatus();
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
