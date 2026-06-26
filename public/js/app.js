// ===== State =====
let projects = [];
let currentProjectId = null;
let currentReportUrl = null;
let selectedFiles = [];

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  loadProjects();
  setupUploadZone();

  // 오늘 날짜를 기본값으로
  document.getElementById('uploadDate').value = new Date().toISOString().slice(0, 10);

  // 저장된 업로더 이름 복원
  const savedName = localStorage.getItem('uploaderName');
  if (savedName) document.getElementById('uploaderName').value = savedName;
});

// ===== API Helpers =====
async function api(url, options = {}) {
  const res = await fetch(url, options);
  return res.json();
}

// ===== Projects =====
async function loadProjects() {
  projects = await api('/api/projects');
  renderProjectList();
  renderDashboard();
}

function renderProjectList() {
  const list = document.getElementById('projectList');
  list.innerHTML = projects.map(p => `
    <li class="${p.id === currentProjectId ? 'active' : ''}" onclick="selectProject('${p.id}')">
      <span class="project-icon">📂</span>
      <span>${escapeHtml(p.name)}</span>
      <span class="report-count">${p.reportCount}</span>
    </li>
  `).join('');
}

function renderDashboard() {
  const stats = document.getElementById('dashboardStats');
  const totalReports = projects.reduce((sum, p) => sum + p.reportCount, 0);

  stats.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${projects.length}</div>
      <div class="stat-label">프로젝트</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalReports}</div>
      <div class="stat-label">전체 리포트</div>
    </div>
  `;

  // 최근 업로드 (각 프로젝트에서 최신 날짜 기준)
  const recent = document.getElementById('recentReports');
  const recentProjects = projects
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

async function selectProject(id) {
  currentProjectId = id;
  renderProjectList();
  showView('projectView');

  const project = projects.find(p => p.id === id);
  document.getElementById('projectTitle').textContent = project.name;

  const grouped = await api(`/api/projects/${id}/reports`);
  renderDateGroups(grouped);
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
          ${reports.map(r => `
            <div class="report-item" onclick="viewReport('${r.id}', '${r.fileName}', '${escapeAttr(r.originalName)}')">
              <span class="ri-icon">📄</span>
              <div class="ri-info">
                <div class="ri-name">${escapeHtml(r.originalName)}</div>
                <div class="ri-meta">${r.uploadedBy} · ${formatTime(r.uploadedAt)}</div>
              </div>
              <div class="ri-actions">
                <button class="btn-icon-sm" onclick="event.stopPropagation(); openReportDirect('${r.fileName}')" title="새 탭에서 열기">↗</button>
                <button class="btn-icon-sm danger" onclick="event.stopPropagation(); deleteReport('${r.id}')" title="삭제">🗑</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ===== Viewer =====
function viewReport(id, fileName, originalName) {
  currentReportUrl = `/uploads/${fileName}`;
  document.getElementById('viewerTitle').textContent = originalName;
  document.getElementById('viewerFrame').src = currentReportUrl;
  showView('reportViewer');
}

function goBackToProject() {
  document.getElementById('viewerFrame').src = '';
  if (currentProjectId) {
    selectProject(currentProjectId);
  } else {
    showView('dashboard');
  }
}

function openReportNewTab() {
  if (currentReportUrl) window.open(currentReportUrl, '_blank');
}

function openReportDirect(fileName) {
  window.open(`/uploads/${fileName}`, '_blank');
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
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.html'));
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
    await loadProjects();
    selectProject(currentProjectId);
  } catch (e) {
    alert('업로드 실패: ' + e.message);
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
  if (currentProjectId) selectProject(currentProjectId);
}

async function deleteCurrentProject() {
  if (!confirm('이 프로젝트와 모든 리포트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
  await api(`/api/projects/${currentProjectId}`, { method: 'DELETE' });
  currentProjectId = null;
  await loadProjects();
  showView('dashboard');
}

// ===== Project Modal =====
function openNewProjectModal() {
  document.getElementById('newProjectName').value = '';
  openModal('newProjectModal');
  setTimeout(() => document.getElementById('newProjectName').focus(), 100);
}

async function createProject() {
  const name = document.getElementById('newProjectName').value.trim();
  if (!name) return;

  const project = await api('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });

  closeModal('newProjectModal');
  await loadProjects();
  selectProject(project.id);
}

// ===== Upload Modal =====
function openUploadModal() {
  selectedFiles = [];
  renderFileList();
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('uploadDate').value = new Date().toISOString().slice(0, 10);
  openModal('uploadModal');
}

// ===== View Switching =====
function showView(viewId) {
  ['dashboard', 'projectView', 'reportViewer'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== viewId);
  });
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

// Enter키로 프로젝트 생성
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
