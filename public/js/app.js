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
            const typeIcon = r.type === 'folder' ? '📂' : r.type === 'markdown' ? '📝' : '📄';
            const typeBadge = r.type === 'folder' ? '<span class="type-badge">ZIP</span>' 
              : r.type === 'markdown' ? '<span class="type-badge md">MD</span>' : '';
            return `
            <div class="report-item" onclick="viewReport('${r.id}', '${escapeAttr(r.indexPath)}', '${escapeAttr(r.originalName)}')">
              <span class="ri-icon">${typeIcon}</span>
              <div class="ri-info">
                <div class="ri-name">${escapeHtml(r.originalName)} ${typeBadge}</div>
                <div class="ri-meta">${r.uploadedBy} · ${formatTime(r.uploadedAt)}</div>
              </div>
              <div class="ri-actions">
                <button class="btn-icon-sm" onclick="event.stopPropagation(); openReportDirect('${escapeAttr(r.indexPath)}')" title="새 탭에서 열기">↗</button>
                <button class="btn-icon-sm danger" onclick="event.stopPropagation(); deleteReport('${r.id}')" title="삭제">🗑</button>
              </div>
            </div>
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
    showProjectView(currentProjectId);
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
  if (currentProjectId) showProjectView(currentProjectId);
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
  openModal('uploadModal');
}

// ===== View Switching =====
function showView(viewId) {
  ['dashboard', 'projectView', 'reportViewer'].forEach(id => {
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
