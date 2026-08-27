let state={projects:[],currentProject:null,currentVersion:null,versions:{},expandedProjects:new Set(),columns:[],cases:[],merges:[],page:1,pageSize:20,total:0,keyword:'',editingCase:null,editingCell:null,inlineEditing:null,editMode:false,mergeMode:false,mergeAnchor:null,sidebarCollapsed:false,quickAddRow:false,currentUser:null,quickInsertTarget:null,quickInsertCount:1,pendingImages:[],pendingEmbeddedImages:[],caseImages:[],caseModalUploadedImageIds:[],caseModalSaving:false};
let draggedVersion=null;
let versionJustDragged=false;
const STATUS_LIST=['通过','失败','未执行','阻塞','跳过'];
const STATUS_COLORS={'通过':'#67c23a','失败':'#f56c6c','未执行':'#909399','阻塞':'#e6a23c','跳过':'#409eff'};
const STATUS_ALIASES={'pass':'通过','passed':'通过','success':'通过','成功':'通过','fail':'失败','failed':'失败','failure':'失败','not run':'未执行','notrun':'未执行','pending':'未执行','blocked':'阻塞','block':'阻塞','skip':'跳过','skipped':'跳过'};
function $(s){return document.querySelector(s);}
function $$(s){return document.querySelectorAll(s);}
function escapeHtml(value){return (value??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function normalizeStatus(value){
  const raw=(value??'').toString().trim();
  return STATUS_ALIASES[raw.toLowerCase()]||raw;
}
let projectNameTooltip=null;
function hideProjectNameTooltip(){
  if(projectNameTooltip) projectNameTooltip.style.display='none';
}
function showProjectNameTooltip(target){
  const fullName=target?.dataset.fullName||'';
  if(!fullName || fullName.length<16)return;
  if(!projectNameTooltip){
    projectNameTooltip=document.createElement('div');
    projectNameTooltip.className='project-name-tooltip';
    document.body.appendChild(projectNameTooltip);
  }
  projectNameTooltip.textContent=fullName;
  projectNameTooltip.style.display='block';
  const rect=target.getBoundingClientRect();
  const margin=12;
  const maxLeft=Math.max(margin,window.innerWidth-projectNameTooltip.offsetWidth-margin);
  const left=Math.min(Math.max(margin,rect.left),maxLeft);
  let top=rect.bottom+6;
  if(top+projectNameTooltip.offsetHeight>window.innerHeight-margin){
    top=Math.max(margin,rect.top-projectNameTooltip.offsetHeight-6);
  }
  projectNameTooltip.style.left=`${left}px`;
  projectNameTooltip.style.top=`${top}px`;
}
function bindProjectNameTooltip(target){
  target.addEventListener('mouseenter',()=>showProjectNameTooltip(target));
  target.addEventListener('mouseleave',hideProjectNameTooltip);
}
async function api(url,opts={}){
  const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message||`请求失败 ${res.status}`);
  return data;
}
function showToast(msg,type='success'){
  const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;
  setTimeout(()=>el.classList.remove('show'),2500);
}
function openModal(id){$(id).classList.add('active');}
function closeModal(id){
  if(id==='#case-modal'&&!state.caseModalSaving&&state.caseModalUploadedImageIds.length){
    void deleteImageRecords(state.caseModalUploadedImageIds);
    state.caseModalUploadedImageIds=[];
  }
  $(id).classList.remove('active');
}

async function doLogin(){
  try{
    const res=await api('/login',{method:'POST',body:JSON.stringify({username:$('#login-username').value,password:$('#login-password').value})});
    if(res.success){
      state.currentUser=res.data;
      $('#login-page').style.display='none';
      $('#app').style.display='flex';
      applyRoleUI();
      await initApp();
    }
  }catch(err){showToast(err.message,'error');}
}

function applyRoleUI(){
  const isAdmin=state.currentUser?.role==='admin';
  $$('.admin-only').forEach(el=>el.style.display=isAdmin?'inline-flex':'none');
}
$('#login-form').addEventListener('submit',e=>{e.preventDefault();doLogin();});

async function initApp(){
  await loadProjects();
  if(state.projects.length){
    const p=state.projects[0];
    state.expandedProjects.add(p.id);state.currentProject=p;
    await loadVersionsForProject(p.id);renderProjects();
    $('#current-project-name').textContent=p.name;
  }else{renderProjects();}
}

async function loadProjects(){
  const res=await api('/api/projects');state.projects=res.data||[];
}

function renderProjects(){
  const list=$('#project-list');list.innerHTML='';
  if(!state.projects.length){list.innerHTML='<div class="empty-state" style="padding:20px">暂无项目</div>';return;}
  state.projects.forEach(p=>{
    const expanded=state.expandedProjects.has(p.id);
    const canManage=state.editMode&&state.currentUser?.role==='admin';
    const node=document.createElement('div');node.className='project-node';
    node.innerHTML=`<div class="project-header ${state.currentProject?.id===p.id?'active':''}" onclick="toggleProject(${p.id})">
      <span class="project-arrow ${expanded?'expanded':''}">▶</span>
      <span class="project-name" title="${escapeHtml(p.name)}" data-full-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
      ${canManage?`<div class="project-actions">
        <button class="secondary" onclick="event.stopPropagation();editProject(${p.id})">编辑</button>
        <button class="danger" onclick="event.stopPropagation();deleteProject(${p.id})">删除</button>
      </div>`:''}
    </div><div class="version-list ${expanded?'expanded':''}"></div>`;
    list.appendChild(node);
    bindProjectNameTooltip(node.querySelector('.project-name'));
    const vList=node.querySelector('.version-list');
    const versions=state.versions[p.id]||[];
    if(expanded){
      if(versions.length){
        versions.forEach(v=>{
          const vi=document.createElement('div');vi.className='version-item'+(state.currentVersion?.id===v.id?' active':'');
          vi.dataset.versionId=v.id;
          if(state.editMode){vi.draggable=true;vi.classList.add('version-sortable');}
          vi.innerHTML=`${state.editMode?'<span class="version-drag-handle" title="拖动排序">⋮⋮</span>':''}<span class="version-name" title="${escapeHtml(v.version_name)}" data-full-name="${escapeHtml(v.version_name)}">${escapeHtml(v.version_name)}</span>
            ${canManage?`<div class="version-actions"><button class="secondary" onclick="event.stopPropagation();editVersion(${p.id},${v.id})">编辑</button><button class="danger" onclick="event.stopPropagation();deleteVersion(${p.id},${v.id})">删除</button></div>`:''}`;
          vi.onclick=e=>{
            if(versionJustDragged){versionJustDragged=false;return;}
            if(e.target.closest('.version-actions'))return;
            state.currentProject=p;
            state.expandedProjects.add(p.id);
            $('#current-project-name').textContent=p.name;
            selectVersion(v.id,p.id);
          };
          vi.addEventListener('contextmenu',e=>{
            if(!state.editMode||state.currentUser?.role!=='admin')return;
            e.preventDefault();e.stopPropagation();showVersionContextMenu(e,p.id,v.id);
          });
          if(state.editMode){
            vi.addEventListener('dragstart',e=>{
              draggedVersion=vi;versionJustDragged=true;vi.classList.add('dragging');
              e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(v.id));
              e.stopPropagation();
            });
            vi.addEventListener('dragover',e=>{
              e.preventDefault();e.stopPropagation();
              if(!draggedVersion||draggedVersion===vi)return;
              const rect=vi.getBoundingClientRect();
              if(e.clientY<rect.top+rect.height/2)vList.insertBefore(draggedVersion,vi);
              else vList.insertBefore(draggedVersion,vi.nextSibling);
              e.dataTransfer.dropEffect='move';
            });
            vi.addEventListener('dragend',async e=>{
              e.stopPropagation();vi.classList.remove('dragging');
              if(draggedVersion===vi){draggedVersion=null;await saveVersionOrder(p.id,vList);}
              setTimeout(()=>{versionJustDragged=false;},0);
            });
          }
          vList.appendChild(vi);
          bindProjectNameTooltip(vi.querySelector('.version-name'));
        });
      }else{vList.innerHTML='<div class="version-empty">暂无版本，点击“新建版本”创建</div>';}
    }
  });
}

async function saveVersionOrder(projectId,list){
  const orders={};
  Array.from(list.querySelectorAll('.version-item')).forEach((item,index)=>{orders[item.dataset.versionId]=index;});
  try{
    const res=await api(`/api/projects/${projectId}/versions/order`,{method:'POST',body:JSON.stringify({orders})});
    state.versions[projectId]=res.data||state.versions[projectId];
    renderProjects();
    showToast('版本排序已保存');
  }catch(err){
    await loadVersionsForProject(projectId);renderProjects();showToast(err.message,'error');
  }
}

async function toggleProject(id){
  if(state.expandedProjects.has(id)){state.expandedProjects.delete(id);}else{state.expandedProjects.add(id);state.currentProject=state.projects.find(p=>p.id===id);await loadVersionsForProject(id);}
  renderProjects();$('#current-project-name').textContent=state.currentProject?.name||'未选择项目';
}

async function loadVersionsForProject(projectId){
  const res=await api(`/api/projects/${projectId}/versions`);state.versions[projectId]=res.data||[];
}

async function selectVersion(id,projectId=null){
  const targetProjectId=projectId??state.currentProject?.id;
  const project=state.projects.find(item=>item.id===targetProjectId);
  if(!project)return;
  state.currentProject=project;
  const versions=state.versions[targetProjectId]||[];
  state.currentVersion=versions.find(v=>v.id===id);state.page=1;
  if(!state.currentVersion)return;
  await Promise.all([loadColumns(),loadCases(),loadStats()]);
  renderProjects();
  $('#current-project-name').textContent=project.name;
  $('#current-version-name').textContent=`${project.name} / ${state.currentVersion.version_name}`;
}

function showVersionContextMenu(event,projectId,versionId){
  removeContextMenu();removeVersionContextMenu();
  const menu=document.createElement('div');menu.id='version-context-menu';menu.className='context-menu';
  menu.style.left=event.pageX+'px';menu.style.top=event.pageY+'px';
  menu.innerHTML='<div>创建版本副本</div>';
  menu.firstElementChild.onclick=()=>{menu.remove();createVersionCopy(projectId,versionId);};
  document.body.appendChild(menu);
  document.addEventListener('click',removeVersionContextMenu,{once:true});
}

function removeVersionContextMenu(){const menu=$('#version-context-menu');if(menu)menu.remove();}

async function createVersionCopy(projectId,versionId){
  const source=(state.versions[projectId]||[]).find(version=>version.id===versionId);
  if(!source)return;
  const name=prompt(`基于“${source.version_name}”创建副本，输入副本名称：`);
  if(name===null||!name.trim())return;
  if(!confirm(`确定创建版本副本“${name.trim()}”吗？将复制该版本的用例、执行结果、图片和合并关系。`))return;
  try{
    const res=await api(`/api/projects/${projectId}/versions/${versionId}/copy`,{method:'POST',body:JSON.stringify({version_name:name.trim()})});
    await loadVersionsForProject(projectId);renderProjects();
    showToast(`版本副本创建成功，共复制 ${res.data?.copied_cases??0} 条用例`);
  }catch(err){showToast(err.message,'error');}
}

async function createProject(){
  const name=prompt('请输入项目名称：');if(!name)return;
  try{
    const res=await api('/api/projects',{method:'POST',body:JSON.stringify({name})});
    await loadProjects();const p=res.data;
    state.expandedProjects.add(p.id);state.currentProject=p;state.versions[p.id]=[];state.currentVersion=null;
    renderProjects();$('#current-project-name').textContent=p.name;$('#current-version-name').textContent='';
    $('#stats-bar').innerHTML='<span>共 0 条</span>';
    showToast('项目创建成功');
  }catch(err){showToast(err.message,'error');}
}

async function editProject(id){
  const p=state.projects.find(x=>x.id===id);const name=prompt('项目名称：',p.name);if(name===null)return;
  try{await api(`/api/projects/${id}`,{method:'PUT',body:JSON.stringify({name,description:p.description})});await loadProjects();renderProjects();if(state.currentProject?.id===id){$('#current-project-name').textContent=name;}showToast('项目更新成功');}catch(err){showToast(err.message,'error');}
}

async function deleteProject(id){
  const pwd=prompt('删除项目需要密码：');if(pwd===null)return;
  if(!confirm('确定要删除该项目吗？所有版本、用例、图片将被清空，此操作不可恢复。'))return;
  try{
    await api(`/api/projects/${id}`,{method:'DELETE',body:JSON.stringify({password:pwd})});
    state.expandedProjects.delete(id);delete state.versions[id];
    if(state.currentProject?.id===id){state.currentProject=null;state.currentVersion=null;}
    await loadProjects();renderProjects();
    if(state.projects.length){const f=state.projects[0];state.expandedProjects.add(f.id);state.currentProject=f;await loadVersionsForProject(f.id);renderProjects();$('#current-project-name').textContent=f.name;}
    else{$('#current-project-name').textContent='未选择项目';$('#current-version-name').textContent='';$('#stats-bar').innerHTML='<span>共 0 条</span>';$('#case-table tbody').innerHTML='<tr><td colspan="100" class="empty-state">暂无项目</td></tr>';$('#pagination').innerHTML='';}
    showToast('项目已删除');
  }catch(err){showToast(err.message,'error');}
}

async function createVersion(){
  if(!state.currentProject){showToast('请先选择一个项目','error');return;}
  const name=prompt('请输入版本名称：');if(!name)return;
  try{await api(`/api/projects/${state.currentProject.id}/versions`,{method:'POST',body:JSON.stringify({version_name:name})});await loadVersionsForProject(state.currentProject.id);renderProjects();showToast('版本创建成功');}catch(err){showToast(err.message,'error');}
}

async function editVersion(projectId,versionId){
  const version=(state.versions[projectId]||[]).find(v=>v.id===versionId);if(!version)return;
  const name=prompt('版本名称：',version.version_name);if(name===null||!name.trim())return;
  try{
    await api(`/api/projects/${projectId}/versions/${versionId}`,{method:'PUT',body:JSON.stringify({version_name:name.trim()})});
    await loadVersionsForProject(projectId);renderProjects();
    if(state.currentVersion?.id===versionId){state.currentVersion=(state.versions[projectId]||[]).find(v=>v.id===versionId);$('#current-version-name').textContent=`${state.currentProject.name} / ${state.currentVersion.version_name}`;}
    showToast('版本更新成功');
  }catch(err){showToast(err.message,'error');}
}

async function deleteVersion(projectId,versionId){
  const pwd=prompt('删除版本需要密码：');if(pwd===null)return;
  if(!confirm('确定删除该版本？版本下所有用例、图片将被清空，此操作不可恢复。'))return;
  try{
    await api(`/api/projects/${projectId}/versions/${versionId}`,{method:'DELETE',body:JSON.stringify({password:pwd})});
    await loadVersionsForProject(projectId);
    if(state.currentVersion?.id===versionId){state.currentVersion=null;state.cases=[];state.total=0;$('#case-table thead').innerHTML='';$('#case-table tbody').innerHTML='<tr><td colspan="100" class="empty-state">请选择版本</td></tr>';$('#pagination').innerHTML='';$('#stats-bar').innerHTML='<span>共 0 条</span>';$('#current-version-name').textContent=state.currentProject.name;}
    renderProjects();showToast('版本已删除');
  }catch(err){showToast(err.message,'error');}
}

async function loadColumns(){
  const res=await api(`/api/projects/${state.currentProject.id}/columns`);state.columns=(res.data||[]).sort((a,b)=>a.sort_order-b.sort_order);
}
function visibleColumns(){return state.columns.filter(c=>c.is_visible);}

async function loadCases(){
  if(!state.currentVersion)return;
  const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/cases?page=${state.page}&page_size=${state.pageSize}&keyword=${encodeURIComponent(state.keyword)}`);
  state.cases=res.data.cases||[];state.total=res.data.total||0;state.columns=res.data.columns||state.columns;state.merges=res.data.merges||[];renderTable();renderPagination();
}

async function loadStats(){
  if(!state.currentVersion)return;
  const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/stats`);
  const {total,stats}=res.data;
  $('#stats-bar').innerHTML=`<span>共 ${total} 条</span>`+STATUS_LIST.map(s=>`<div class="stat-item"><span class="stat-dot" style="background:${STATUS_COLORS[s]}"></span><span>${s}: ${stats[s].count} (${stats[s].percent}%)</span></div>`).join('');
  await loadSummary();
}

async function loadSummary(){
  if(!state.currentVersion)return;
  try{
    const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/summary`);
    const d=res.data;
    const btn=$('#btn-summary');
    btn.disabled=!d.can_summarize;
    btn.dataset.summary=JSON.stringify(d);
  }catch(err){console.error(err);}
}

function openSummaryModal(){
  const btn=$('#btn-summary');
  if(btn.disabled)return;
  const d=JSON.parse(btn.dataset.summary||'{}');
  const body=$('#summary-body');
  body.innerHTML=`
    <div class="summary-cards">
      <div class="summary-card"><div class="summary-num">${d.total}</div><div>总用例</div></div>
      <div class="summary-card"><div class="summary-num">${d.executed}</div><div>已执行</div></div>
      <div class="summary-card success"><div class="summary-num">${d.success}</div><div>成功</div></div>
      <div class="summary-card fail"><div class="summary-num">${d.fail}</div><div>失败</div></div>
      <div class="summary-card block"><div class="summary-num">${d.block}</div><div>阻塞</div></div>
      <div class="summary-card skip"><div class="summary-num">${d.skip}</div><div>跳过</div></div>
    </div>
    <div class="summary-section">
      <h4>阻塞原因（${(d.block_reasons||[]).length}）</h4>
      ${(d.block_reasons||[]).length?'<ol>'+d.block_reasons.map(r=>`<li><b>${r.case_no?r.case_no+' ':''}${r.title}</b>：${r.reason}</li>`).join('')+'</ol>':'<p class="empty">无</p>'}
    </div>
    <div class="summary-section">
      <h4>跳过原因（${(d.skip_reasons||[]).length}）</h4>
      ${(d.skip_reasons||[]).length?'<ol>'+d.skip_reasons.map(r=>`<li><b>${r.case_no?r.case_no+' ':''}${r.title}</b>：${r.reason}</li>`).join('')+'</ol>':'<p class="empty">无</p>'}
    </div>
  `;
  openModal('#summary-modal');
}

function renderTable(){
  if(state.quickAddRow){renderQuickAddRows();return;}
  const cols=visibleColumns();const thead=$('#case-table thead');const tbody=$('#case-table tbody');
  const showActions=state.editMode;
  const showSelection=state.editMode;
  const ths=cols.map(c=>`<th data-key="${escapeHtml(c.key)}" data-id="${c.id}" style="width:${c.width}px"><span class="col-title">${escapeHtml(c.name)}</span>${state.editMode?'<div class="resize-handle"></div>':''}</th>`).join('');
  thead.innerHTML=`<tr>${showSelection?'<th class="select-header" style="width:44px"><input type="checkbox" id="select-all-cases" title="全选当前页" onchange="toggleAllCases(this.checked)"></th>':''}${ths}${showActions?'<th class="actions-header" style="width:150px">操作</th>':''}</tr>`;
  tbody.innerHTML='';
  if(!state.cases.length){tbody.innerHTML=`<tr><td colspan="${cols.length+(showActions?1:0)+(showSelection?1:0)}" class="empty-state">暂无数据</td></tr>`;return;}
  const pageIds=state.cases.map(tc=>tc.id);
  state.cases.forEach(tc=>{
    const cells=cols.map(c=>renderCell(c,tc,pageIds));
    const tr=document.createElement('tr');
    tr.dataset.caseId=tc.id;
    tr.addEventListener('contextmenu',showRowContextMenu);
    tr.innerHTML=`${showSelection?`<td class="select-cell"><input type="checkbox" class="case-select" value="${tc.id}" onchange="updateSelectedCaseCount()" onclick="event.stopPropagation()" title="选择用例"></td>`:''}${cells.join('')}${showActions?`<td class="actions-cell">${renderRowActions(tc.id)}</td>`:''}`;
    tbody.appendChild(tr);
  });
  if(state.editMode)bindColumnResize();
  updateSelectedCaseCount();
}

function toggleAllCases(checked){
  $$('.case-select').forEach(box=>{box.checked=checked;});
  updateSelectedCaseCount();
}

function updateSelectedCaseCount(){
  const selected=$$('.case-select:checked').length;
  const button=$('#btn-batch-delete');
  if(button)button.textContent=selected?`批量删除（${selected}）`:'批量删除';
  const all=$$('.case-select').length>0&&selected===$$('.case-select').length;
  const header=$('#select-all-cases');
  if(header)header.checked=all;
}

async function deleteSelectedCases(){
  if(!state.editMode)return;
  const ids=Array.from($$('.case-select:checked')).map(box=>parseInt(box.value,10)).filter(Number.isInteger);
  if(!ids.length){showToast('请先选择要删除的用例','error');return;}
  if(!confirm(`确定删除选中的 ${ids.length} 条用例吗？关联图片和合并关系也会删除，此操作不可恢复。`))return;
  try{
    const res=await api('/api/cases/batch-delete',{method:'POST',body:JSON.stringify({case_ids:ids})});
    await Promise.all([loadCases(),loadStats()]);
    showToast(`已删除 ${res.data?.deleted??ids.length} 条用例`);
  }catch(err){showToast(err.message,'error');}
}

function renderRowActions(id){
  return `<button class="secondary" onclick="editCase(${id})">编辑</button><button class="danger" onclick="deleteCase(${id})">删除</button>`;
}

function showRowContextMenu(e){
  e.preventDefault();
  const caseId=e.currentTarget.dataset.caseId;
  removeContextMenu();
  const menu=document.createElement('div');menu.id='row-context-menu';menu.className='context-menu';
  menu.style.left=e.pageX+'px';menu.style.top=e.pageY+'px';
  menu.innerHTML=`
    <div onclick="insertQuickRow(${caseId},'above',1);removeContextMenu();">在上方插入行</div>
    <div onclick="insertQuickRow(${caseId},'below',1);removeContextMenu();">在下方插入行</div>
    <div onclick="insertQuickRowPrompt(${caseId},'above');removeContextMenu();">在上方插入多行</div>
    <div onclick="insertQuickRowPrompt(${caseId},'below');removeContextMenu();">在下方插入多行</div>
  `;
  document.body.appendChild(menu);
  document.addEventListener('click',removeContextMenu,{once:true});
}

function removeContextMenu(){
  const m=$('#row-context-menu');if(m)m.remove();
}

function findMerge(c,caseId){return state.merges.find(merge=>merge.column_key===c.key&&(merge.case_ids||[]).includes(caseId));}

function renderCell(c,tc,pageIds=[]){
  const merge=findMerge(c,tc.id);
  if(merge){
    const visibleIds=(merge.case_ids||[]).filter(id=>pageIds.includes(id));
    if(visibleIds.length>1&&visibleIds[0]!==tc.id)return '';
    if(visibleIds.length>1)return renderCellContent(c,tc,visibleIds.length);
  }
  return renderCellContent(c,tc,1);
}

function renderCellContent(c,tc,rowspan=1){
  const selected=state.mergeAnchor?.key===c.key&&state.mergeAnchor?.caseId===tc.id;
  if(c.key==='status'){
    const selectAttr=state.mergeMode?` onclick="selectMergeCell(event,'${escapeHtml(c.key)}',${tc.id})"`:'';
    const status=normalizeStatus(tc.status);
    const displayStatus=STATUS_LIST.includes(status)?status:'未执行';
    const statusColor=STATUS_COLORS[displayStatus]||'#606266';
    return `<td class="${rowspan>1?'merged-cell ':''}${state.mergeMode?'merge-selectable ':''}${selected?'merge-anchor':''}"${rowspan>1?` rowspan="${rowspan}"`:''}${selectAttr}><select class="status-select status-${escapeHtml(displayStatus)}" style="color:${statusColor}" onchange="updateStatus(${tc.id},this.value,this)">${STATUS_LIST.map(s=>`<option value="${escapeHtml(s)}" ${displayStatus===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select></td>`;
  }
  let val=tc[c.key];if(c.key==='custom_fields'){const custom=tc.custom_fields||{};val=Object.values(custom).join(' ');}
  const isRich=isRichTextValue(val);
  const str=escapeHtml(isRich?richTextPlainText(val):val);
  const contentHtml=isRich?richTextHtml(val):str.replace(/\n/g,'<br>');
  const mergeAttr=rowspan>1?` rowspan="${rowspan}"`:'';
  const mergeClass=rowspan>1?'merged-cell ':'';
  const multiline=c.key==='steps'||c.key==='remark'||c.key==='precondition'||c.key==='expected_result'||!c.is_system;
  let interaction='';
  if(state.mergeMode){
    interaction=` onclick="selectMergeCell(event,'${escapeHtml(c.key)}',${tc.id})"`;
  }else if(state.editMode){
    interaction=` onclick="beginCellEdit(this,'${escapeHtml(c.key)}',${tc.id})" ondblclick="startInlineEdit(this,'${escapeHtml(c.key)}',${tc.id})"`;
  }
  return `<td data-key="${escapeHtml(c.key)}" data-case="${tc.id}" class="${mergeClass}${state.mergeMode?'merge-selectable ':''}${selected?'merge-anchor ':''}cell-text ${multiline?'multiline':''} ${c.key==='remark'?'rich-cell':''}"${mergeAttr}${interaction} title="${str}">${contentHtml}</td>`;
}

function toggleMergeMode(mode){
  state.mergeMode=state.mergeMode===mode?false:mode;state.mergeAnchor=null;renderTable();
  showToast(state.mergeMode?(mode==='merge'?'请选择同一列的起止单元格':'请选择要取消合并的单元格'):'已退出单元格操作');
}
async function selectMergeCell(event,key,caseId){
  event.stopPropagation();
  if(state.mergeMode==='unmerge'){
    const merge=findMerge({key},caseId);if(!merge){showToast('该单元格未合并','error');return;}
    try{await api(`/api/merges/${merge.id}`,{method:'DELETE'});state.mergeAnchor=null;await loadCases();showToast('已取消合并');}catch(err){showToast(err.message,'error');}
    return;
  }
  if(!state.mergeAnchor){state.mergeAnchor={key,caseId};renderTable();return;}
  if(state.mergeAnchor.key!==key){showToast('请选择同一列的单元格','error');return;}
  const ids=state.cases.map(tc=>tc.id);const start=ids.indexOf(state.mergeAnchor.caseId);const end=ids.indexOf(caseId);
  if(start<0||end<0){showToast('请选择当前页面中的单元格','error');return;}
  const [from,to]=start<end?[start,end]:[end,start];
  if(to-from<1){showToast('至少选择两个连续单元格','error');return;}
  try{
    await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/merges`,{method:'POST',body:JSON.stringify({column_key:key,case_ids:ids.slice(from,to+1)})});
    state.mergeMode=false;state.mergeAnchor=null;await loadCases();showToast('单元格合并成功');
  }catch(err){showToast(err.message,'error');}
}

function renderPagination(){
  const tp=Math.max(1,Math.ceil(state.total/state.pageSize));
  $('#pagination').innerHTML=`<span>共 ${state.total} 条</span><select onchange="changePageSize(this.value)"><option value="20" ${state.pageSize===20?'selected':''}>20 条/页</option><option value="50" ${state.pageSize===50?'selected':''}>50 条/页</option><option value="100" ${state.pageSize===100?'selected':''}>100 条/页</option></select><button ${state.page<=1?'disabled':''} onclick="changePage(${state.page-1})">上一页</button><span>${state.page} / ${tp}</span><button ${state.page>=tp?'disabled':''} onclick="changePage(${state.page+1})">下一页</button>`;
}
function changePage(p){const tp=Math.max(1,Math.ceil(state.total/state.pageSize));if(p<1||p>tp)return;state.page=p;loadCases();}
function changePageSize(s){state.pageSize=parseInt(s);state.page=1;loadCases();}

function isRichTextValue(value){return /<(?:img|br|div|p|s|strike|del)\b/i.test((value??'').toString());}
function richTextHtml(value){
  const raw=(value??'').toString();
  if(!isRichTextValue(raw))return escapeHtml(raw).replace(/\r?\n/g,'<br>');
  const template=document.createElement('template');
  template.innerHTML=raw;
  template.content.querySelectorAll('script,style,iframe,object,embed,link').forEach(node=>node.remove());
  template.content.querySelectorAll('*').forEach(node=>{
    Array.from(node.attributes).forEach(attr=>{
      if(attr.name.toLowerCase().startsWith('on'))node.removeAttribute(attr.name);
    });
    if(node.tagName==='IMG'){
      const src=node.getAttribute('src')||'';
      if(!src.startsWith('/api/images/'))node.remove();
      else{
        node.setAttribute('class','rich-content-image');
        node.setAttribute('alt',node.getAttribute('alt')||'图片');
      }
    }
  });
  return template.innerHTML;
}
function richTextPlainText(value){
  const raw=(value??'').toString();
  if(!isRichTextValue(raw))return raw;
  const box=document.createElement('div');box.innerHTML=richTextHtml(raw);
  box.querySelectorAll('img').forEach(img=>img.replaceWith('[图片]'));
  return box.innerText||box.textContent||'';
}
function getEditorValue(editor){
  if(!editor)return '';
  if(editor.isContentEditable)return editor.innerHTML;
  return (editor.value??'').replace(/\r\n/g,'\n');
}
function setEditorValue(editor,value){
  if(!editor)return;
  if(editor.isContentEditable)editor.innerHTML=richTextHtml(value);
  else editor.value=(value??'').toString();
}
function embeddedImageIds(value){
  const ids=[];const box=document.createElement('div');box.innerHTML=richTextHtml(value);
  box.querySelectorAll('img[data-image-id]').forEach(img=>{const id=Number(img.dataset.imageId);if(Number.isInteger(id)&&id>0)ids.push(id);});
  return [...new Set(ids)];
}
async function deleteImageRecords(ids){
  for(const id of [...new Set(ids||[])]){
    try{await api(`/api/images/${id}`,{method:'DELETE'});}catch(err){console.warn('删除图片记录失败',id,err);}
  }
}
async function cleanupRemovedEmbeddedImages(caseId,oldValue,newValue,extraIds=[]){
  if(!caseId)return;
  const oldIds=embeddedImageIds(oldValue);const newIds=new Set(embeddedImageIds(newValue));
  const removed=oldIds.filter(id=>!newIds.has(id));
  const extra=(extraIds||[]).filter(id=>!newIds.has(id));
  await deleteImageRecords([...new Set([...removed,...extra])]);
}

function getEditableCellValue(td){
  const editor=td.querySelector('.inline-cell-editor');
  return editor?getEditorValue(editor):(td.innerText||td.textContent||'').replace(/\r\n/g,'\n');
}

function beginCellEdit(td,key,caseId){
  if(!state.editMode||state.mergeMode)return;
  const tc=state.cases.find(c=>c.id===caseId);if(!tc)return;
  const col=state.columns.find(c=>c.key===key);if(!col)return;
  if(state.inlineEditing?.td===td){td.focus();return;}
  if(state.inlineEditing)void commitInlineCellEdit(state.inlineEditing);

  const oldVal=(tc[key]??'').toString();
  const editing={td,key,caseId,col,oldVal,originalHtml:td.innerHTML,originalTitle:td.title,finished:false,uploadedImageIds:[]};
  state.inlineEditing=editing;
  td.classList.add('cell-editing');
  td.removeAttribute('title');
  const multiline=['steps','remark','precondition','expected_result'].includes(key)||!col.is_system;
  const richEditor=true;
  const editor=document.createElement(richEditor?'div':(multiline?'textarea':'input'));
  editor.className='inline-cell-editor';
  if(richEditor){editor.contentEditable='true';editor.classList.add('rich-editor');setEditorValue(editor,oldVal);}
  else editor.value=oldVal;
  if(multiline){editor.rows=Math.max(3,Math.min(8,oldVal.split('\n').length+1));}
  td.textContent='';
  td.appendChild(editor);
  editing.editor=editor;
  editor.onblur=()=>{void commitInlineCellEdit(editing);};
  editor.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();cancelInlineCellEdit(editing);return;}
    if(e.key==='Enter'&&(!multiline||e.ctrlKey)){
      e.preventDefault();void commitInlineCellEdit(editing);
    }
  };
  editor.focus();
  if(typeof editor.select==='function')editor.select();
  else{const range=document.createRange();range.selectNodeContents(editor);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
}

async function commitInlineCellEdit(editing){
  if(!editing||editing.finished)return;
  editing.finished=true;
  const {td,key,caseId,col,oldVal}=editing;
  const value=getEditableCellValue(td);
  td.classList.remove('cell-editing');
  if(editing.editor){editing.editor.onblur=null;editing.editor.onkeydown=null;}
  if(state.inlineEditing===editing)state.inlineEditing=null;
  if(value===oldVal){td.title=editing.originalTitle;return;}
  try{
    const payload=col.is_system?{[key]:value}:{custom_fields:{[key]:value}};
    await api(`/api/cases/${caseId}`,{method:'PUT',body:JSON.stringify(payload)});
    if(key==='remark')await cleanupRemovedEmbeddedImages(caseId,oldVal,value,editing.uploadedImageIds);
    await loadCases();
  }catch(err){
    showToast(err.message,'error');
    if(state.inlineEditing===null)renderTable();
  }
}

function cancelInlineCellEdit(editing){
  if(!editing||editing.finished)return;
  editing.finished=true;
  editing.td.classList.remove('cell-editing');
  editing.td.innerHTML=editing.originalHtml;
  editing.td.title=editing.originalTitle;
  if(editing.editor){editing.editor.onblur=null;editing.editor.onkeydown=null;}
  if(editing.uploadedImageIds?.length)void deleteImageRecords(editing.uploadedImageIds);
  if(state.inlineEditing===editing)state.inlineEditing=null;
}

function startInlineEdit(td,key,caseId){
  if(!state.editMode)return;
  const tc=state.cases.find(c=>c.id===caseId);if(!tc)return;
  const col=state.columns.find(c=>c.key===key);if(!col)return;
  let valueOverride=null;
  if(state.inlineEditing?.td===td){
    const editing=state.inlineEditing;
    valueOverride=getEditableCellValue(td);
    cancelInlineCellEdit(editing);
  }else if(state.inlineEditing){
    void commitInlineCellEdit(state.inlineEditing);
  }
  const oldVal=(valueOverride??tc[key]??'').toString();
  state.editingCell={caseId,key,col,oldVal,uploadedImageIds:[]};
  $('#cell-editor-title').textContent=`编辑：${col.name}`;
  setEditorValue($('#cell-editor-input'),oldVal);
  state.caseImages=[];
  openModal('#cell-editor-modal');
  renderImageList();
  void loadCaseImages(caseId);
  setTimeout(()=>$('#cell-editor-input').focus(),0);
}

async function saveCellEditor(){
  const editing=state.editingCell;if(!editing)return;
  const value=getEditorValue($('#cell-editor-input'));
  if(value===editing.oldVal){closeCellEditor();return;}
  try{
    const payload=editing.col.is_system?{[editing.key]:value}:{custom_fields:{[editing.key]:value}};
    await api(`/api/cases/${editing.caseId}`,{method:'PUT',body:JSON.stringify(payload)});
    if(editing.key==='remark')await cleanupRemovedEmbeddedImages(editing.caseId,editing.oldVal,value,editing.uploadedImageIds);
    closeCellEditor(true);await Promise.all([loadCases(),loadStats()]);
  }catch(err){showToast(err.message,'error');}
}

function closeCellEditor(saved=false){
  if(!saved&&state.editingCell?.uploadedImageIds?.length)void deleteImageRecords(state.editingCell.uploadedImageIds);
  closeModal('#cell-editor-modal');state.editingCell=null;state.caseImages=[];renderImageList();
}

async function updateStatus(id,status,select){
  status=normalizeStatus(status);
  if(select){
    select.className=`status-select status-${escapeHtml(status)}`;
    select.style.color=STATUS_COLORS[status]||'#606266';
  }
  try{await api(`/api/cases/${id}`,{method:'PUT',body:JSON.stringify({status})});await Promise.all([loadCases(),loadStats()]);}catch(err){showToast(err.message,'error');}
}

async function resetCaseNumbers(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  if(!confirm('确定将当前版本的用例编号按列表顺序重置为 1、2、3……吗？'))return;
  try{
    const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/cases/reset-numbers`,{method:'POST'});
    await loadCases();
    showToast(`已重置 ${res.data?.reset||0} 条用例编号`);
  }catch(err){showToast(err.message,'error');}
}

function openCaseModal(tc=null){
  state.editingCase=tc;$('#case-modal-title').textContent=tc?'编辑用例':'新增用例';
  const body=$('#case-form-body');
  // 编辑字段严格跟随列表当前可见列，避免编辑弹窗出现表格中不存在的字段。
  const cols=visibleColumns();
  const fieldHtml=cols.map(c=>{
    const value=c.is_system?(tc?.[c.key]??''):(tc?.custom_fields?.[c.key]??'');
    let control;
    if(c.key==='status'){
      control=`<select class="case-form-field" data-key="${escapeHtml(c.key)}">${STATUS_LIST.map(s=>`<option value="${escapeHtml(s)}" ${value===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select>`;
    }else{
      control=`<div class="case-form-field rich-editor" data-key="${escapeHtml(c.key)}" contenteditable="true" role="textbox" data-placeholder="可直接输入；选中文字后可使用删除线">${richTextHtml(value)}</div>`;
    }
    return `<div class="form-group full" style="margin-bottom:14px"><label>${escapeHtml(c.name)}</label>${control}</div>`;
  }).join('');
  body.innerHTML=`<div class="rich-format-toolbar"><button type="button" class="secondary" onmousedown="event.preventDefault()" onclick="toggleStrike()">删除线</button><span>选中文字后点击“删除线”，或按 Ctrl+Shift+X</span></div>${fieldHtml||'<p class="empty-state" style="padding:20px">当前没有可编辑的显示列</p>'}
    <div class="form-group full"><label>图片附件</label><input type="file" id="case-images" multiple accept="image/*"><button type="button" class="secondary paste-image-btn" onclick="pasteImageFromClipboard()">从剪贴板粘贴图片</button><p style="font-size:12px;color:#909399;margin-top:4px">也可以在输入框中按 Ctrl+V 粘贴；图片会先显示缩略图，保存后上传</p><div class="image-list" id="image-list"></div></div>`;
  state.pendingImages=[];state.pendingEmbeddedImages=[];state.caseImages=[];state.caseModalUploadedImageIds=[];state.caseModalSaving=false;openModal('#case-modal');state.pasteTarget=tc?tc.id:null;
  $('#case-images').addEventListener('change',e=>{addPendingImages(Array.from(e.target.files||[]));e.target.value='';});
  if(tc)loadCaseImages(tc.id);else renderImageList();
}

function toggleStrike(){
  const selection=window.getSelection();
  const node=selection?.anchorNode;
  const element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  const target=element?.closest?.('[contenteditable="true"]')||document.activeElement?.closest?.('[contenteditable="true"]');
  if(!target)return;
  target.focus();
  document.execCommand('strikeThrough',false,null);
  target.dispatchEvent(new Event('input',{bubbles:true}));
}

async function loadCaseImages(caseId){
  const res=await api(`/api/cases/${caseId}/images`);state.caseImages=res.data||[];renderImageList();
}

function getImageSrc(img){
  if(img.previewUrl)return img.previewUrl;
  if(img.content_url)return img.content_url;
  return '';
}
function renderImageList(){
  renderImageListInto($('#image-list'),state.editingCase?.id);
  renderImageListInto($('#cell-image-list'),state.editingCell?.caseId);
}
function renderImageListInto(list,caseId){
  if(!list)return;
  list.innerHTML='';
  state.caseImages.forEach(img=>appendImagePreview(list,img,()=>deleteImage(img.id,caseId)));
  if(list.id!=='image-list')return;
  state.pendingImages.forEach((file,index)=>{
    const preview={previewUrl:URL.createObjectURL(file),filename:file.name};
    appendImagePreview(list,preview,()=>{state.pendingImages.splice(index,1);renderImageList();});
  });
}
function appendImagePreview(list,img,onDelete){
  const wrapper=document.createElement('div');wrapper.className='image-preview';
  const image=document.createElement('img');image.src=getImageSrc(img);image.className='image-thumb';image.title='点击或双击放大';image.addEventListener('click',()=>openLightbox(image.src));image.addEventListener('dblclick',()=>openLightbox(image.src));
  const button=document.createElement('button');button.className='danger image-delete';button.type='button';button.textContent='×';button.title='删除图片';button.addEventListener('click',onDelete);
  wrapper.append(image,button);list.appendChild(wrapper);
}
function addPendingImages(files){
  const accepted=files.filter(isImageFile);
  state.pendingImages.push(...accepted);renderImageList();
  return accepted;
}
function captureRichSelection(target){
  if(!target?.isContentEditable)return null;
  const selection=window.getSelection();
  if(!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);
  return target.contains(range.commonAncestorContainer)?range.cloneRange():null;
}
function insertImageAtCaret(target,src,imageId=null,pendingToken=null,selectionRange=null){
  if(!target?.isContentEditable)return false;
  target.focus();
  const selection=window.getSelection();selection.removeAllRanges();
  if(selectionRange&&target.contains(selectionRange.commonAncestorContainer))selection.addRange(selectionRange);
  else{const range=document.createRange();range.selectNodeContents(target);range.collapse(false);selection.addRange(range);}
  const range=selection.getRangeAt(0);const image=document.createElement('img');
  image.className='rich-content-image';image.src=src;image.alt='图片';
  if(imageId)image.dataset.imageId=String(imageId);
  if(pendingToken)image.dataset.pendingImage=pendingToken;
  range.deleteContents();range.insertNode(image);range.setStartAfter(image);range.collapse(true);
  selection.removeAllRanges();selection.addRange(range);
  target.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
async function pasteImageFromClipboard(){
  if(!navigator.clipboard?.read){showToast('当前浏览器不支持读取剪贴板，请直接按 Ctrl+V','error');return;}
  try{
    const files=[];
    for(const item of await navigator.clipboard.read()){
      for(const type of item.types.filter(type=>type.startsWith('image/'))){
        const blob=await item.getType(type);files.push(new File([blob],`pasted-${Date.now()}.${type.split('/')[1]||'png'}`,{type}));
      }
    }
    if(!files.length){showToast('剪贴板中没有图片','error');return;}
    const target=document.activeElement?.closest?.('[contenteditable="true"]')||document.activeElement;
    await handlePastedImages(files,target,captureRichSelection(target));
  }catch(err){showToast('无法读取剪贴板，请确认浏览器已允许剪贴板权限','error');}
}
async function uploadImageFiles(caseId,files){
  if(!files.length)return [];
  const form=new FormData();files.forEach(file=>form.append('images',file));
  const res=await fetch(`/api/cases/${caseId}/images`,{method:'POST',body:form});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||'图片上传失败');
  return data.data||[];
}
async function deleteImage(imageId,caseId){if(!confirm('确定删除该图片？'))return;try{await api(`/api/images/${imageId}`,{method:'DELETE'});await loadCaseImages(caseId);}catch(err){showToast(err.message,'error');}}
function addCase(){openCaseModal();}
function editCase(id){openCaseModal(state.cases.find(c=>c.id===id));}

async function saveCase(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  const payload={project_id:state.currentProject.id,version_id:state.currentVersion.id,custom_fields:{}};
  $$('.case-form-field').forEach(input=>{
    const col=state.columns.find(c=>c.key===input.dataset.key);if(!col)return;
    const value=getEditorValue(input);
    if(col.is_system)payload[col.key]=value;
    else payload.custom_fields[col.key]=value;
  });
  const oldRemark=state.editingCase?.remark||'';
  const pendingMarkup=payload.remark||'';
  const createPayload={...payload,remark:pendingMarkup.replace(/<img[^>]*data-pending-image="[^"]+"[^>]*>/gi,'')};
  try{
    let caseId;
    if(state.editingCase){
      const res=await api(`/api/cases/${state.editingCase.id}`,{method:'PUT',body:JSON.stringify(payload)});
      caseId=state.editingCase.id;
      // 更新本地缓存，确保列表立即回显
      const idx=state.cases.findIndex(c=>c.id===caseId);
      if(idx>=0&&res.data)state.cases[idx]=res.data;
    }else{
      const res=await api('/api/cases',{method:'POST',body:JSON.stringify(createPayload)});
      caseId=res.data.id;
    }
    const selectedFiles=Array.from($('#case-images')?.files||[]).concat(state.pendingImages);
    const uploaded=selectedFiles.length?await uploadImageFiles(caseId,selectedFiles):[];
    const uploadedByFile=new Map(selectedFiles.map((file,index)=>[file,uploaded[index]]));
    let finalRemark=pendingMarkup;
    for(const pending of state.pendingEmbeddedImages){
      const image=uploadedByFile.get(pending.file);if(!image)continue;
      const src=getImageSrc(image);
      const imageHtml=`<img class="rich-content-image" data-image-id="${image.id}" src="${escapeHtml(src)}" alt="图片">`;
      const marker=new RegExp(`<img\\b[^>]*data-pending-image=["']${pending.token}["'][^>]*>`, 'gi');
      finalRemark=finalRemark.replace(marker,imageHtml);
      if(!finalRemark.includes(`data-image-id="${image.id}"`))finalRemark+=imageHtml;
    }
    if(state.pendingEmbeddedImages.length&&finalRemark!==pendingMarkup){
      await api(`/api/cases/${caseId}`,{method:'PUT',body:JSON.stringify({remark:finalRemark})});
    }
    if(state.editingCase)await cleanupRemovedEmbeddedImages(caseId,oldRemark,finalRemark,state.caseModalUploadedImageIds);
    state.caseModalSaving=true;
    state.pendingImages=[];state.pendingEmbeddedImages=[];state.caseImages=[];state.caseModalUploadedImageIds=[];closeModal('#case-modal');state.caseModalSaving=false;state.pasteTarget=null;
    await loadColumns();
    await Promise.all([loadCases(),loadStats(),loadSummary()]);
    showToast('保存成功');
  }catch(err){showToast(err.message,'error');}
}

async function deleteCase(id){if(!confirm('确定删除该用例？'))return;try{await api(`/api/cases/${id}`,{method:'DELETE'});await Promise.all([loadCases(),loadStats()]);showToast('用例已删除');}catch(err){showToast(err.message,'error');}}

function addQuickRow(){
  if(!state.currentVersion){showToast('请先选择一个版本','error');return;}
  const count=prompt('要添加多少行？',1);
  if(count===null)return;
  state.quickInsertCount=Math.max(1,Math.min(99,parseInt(count)||1));
  state.quickInsertTarget={type:'top'};
  state.quickAddRow=true;
  renderQuickAddRows();
}

function insertQuickRow(caseId,position,count=1){
  if(!state.currentVersion)return;
  state.quickInsertTarget={type:position,caseId:caseId};
  state.quickInsertCount=Math.max(1,Math.min(99,count));
  state.quickAddRow=true;
  renderQuickAddRows();
}

function insertQuickRowPrompt(caseId,position){
  const n=prompt('插入行数（1~99）：',1);
  if(n===null)return;
  insertQuickRow(caseId,position,parseInt(n)||1);
}

function cancelQuickRow(){state.quickAddRow=false;state.quickInsertTarget=null;state.quickInsertCount=1;renderTable();}

function buildQuickInputRow(i,cols){
  return cols.map(c=>{
    if(c.key==='status')return `<td><select id="qa-status-${i}">${STATUS_LIST.map(s=>`<option value="${s}" ${s==='未执行'?'selected':''}>${s}</option>`).join('')}</select></td>`;
    const isLong=c.key==='steps'||c.key==='remark'||c.key==='precondition'||c.key==='expected_result'||!c.is_system;
    return `<td>${isLong?`<textarea id="qa-${c.key}-${i}"></textarea>`:`<input id="qa-${c.key}-${i}">`}</td>`;
  }).join('')+`<td class="actions-cell">${i===0?`<button onclick="saveQuickRows()">保存</button><button class="secondary" onclick="cancelQuickRow()">取消</button>`:'&nbsp;'}</td>`;
}

function renderQuickAddRows(){
  const cols=visibleColumns();
  const thead=$('#case-table thead');
  const tbody=$('#case-table tbody');
  const ths=cols.map(c=>`<th data-key="${escapeHtml(c.key)}" data-id="${c.id}" style="width:${c.width}px"><span class="col-title">${escapeHtml(c.name)}</span></th>`).join('');
  thead.innerHTML=`<tr>${ths}<th class="actions-header" style="width:132px">操作</th></tr>`;
  tbody.innerHTML='';
  const count=state.quickInsertCount||1;
  const target=state.quickInsertTarget||{type:'top'};
  const targetId=target.caseId;
  const pos=target.type;

  function appendInputRow(i){const tr=document.createElement('tr');tr.className='quick-add-row';tr.innerHTML=buildQuickInputRow(i,cols);tbody.appendChild(tr);}

  if(pos==='top'){
    for(let i=0;i<count;i++)appendInputRow(i);
    state.cases.forEach(tc=>{const tr=document.createElement('tr');tr.dataset.caseId=tc.id;tr.addEventListener('contextmenu',showRowContextMenu);tr.innerHTML=cols.map(c=>renderCell(c,tc)).join('')+`<td class="actions-cell">${renderRowActions(tc.id)}</td>`;tbody.appendChild(tr);});
  }else if(pos==='above'||pos==='below'){
    state.cases.forEach(tc=>{
      if(pos==='above'&&tc.id===targetId){for(let i=0;i<count;i++)appendInputRow(i);}
      const tr=document.createElement('tr');tr.dataset.caseId=tc.id;tr.addEventListener('contextmenu',showRowContextMenu);tr.innerHTML=cols.map(c=>renderCell(c,tc)).join('')+`<td class="actions-cell">${renderRowActions(tc.id)}</td>`;tbody.appendChild(tr);
      if(pos==='below'&&tc.id===targetId){for(let i=0;i<count;i++)appendInputRow(i);}
    });
  }else{
    for(let i=0;i<count;i++)appendInputRow(i);
  }
}

async function saveQuickRows(){
  if(!state.currentVersion)return;
  const cols=visibleColumns();
  const count=state.quickInsertCount||1;
  const target=state.quickInsertTarget||{};
  const payloads=[];
  for(let i=0;i<count;i++){
    const payload={project_id:state.currentProject.id,version_id:state.currentVersion.id,custom_fields:{}};
    cols.forEach(c=>{const el=$(`#qa-${c.key}-${i}`);if(!el)return;if(c.is_system)payload[c.key]=el.value;else payload.custom_fields[c.key]=el.value;});
    payloads.push(payload);
  }
  try{
    await api('/api/cases/batch',{
      method:'POST',
      body:JSON.stringify({
        project_id:state.currentProject.id,
        version_id:state.currentVersion.id,
        cases:payloads,
        insert_target:target.caseId||null,
        insert_position:target.type==='top'?null:target.type
      })
    });
    state.quickAddRow=false;state.quickInsertTarget=null;state.quickInsertCount=1;
    await Promise.all([loadCases(),loadStats(),loadSummary()]);
    showToast('已添加');
  }catch(err){showToast(err.message,'error');}
}

let draggedColumnItem=null;

function openColumnModal(){
  const body=$('#column-form-body');
  const systemOptions=state.columns.filter(c=>c.is_system).map(c=>`<option value="${escapeHtml(c.key)}">转为“${escapeHtml(c.name)}”</option>`).join('');
  body.innerHTML=state.columns.map((c,idx)=>`
    <div class="column-setting-item" draggable="true" data-id="${c.id}" data-key="${escapeHtml(c.key)}" data-system="${c.is_system?'true':'false'}" data-idx="${idx}">
      <span class="drag-handle">⋮⋮</span>
      <label>
        <input type="checkbox" class="col-vis" data-id="${c.id}" ${c.is_visible?'checked':''}>
      </label>
      <span class="column-setting-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
      ${c.is_system?'<span class="tag">系统列</span>':'<span class="tag custom-tag">自定义列</span>'}
      ${c.is_system&&c.key==='case_no'?`<button class="secondary reset-column-number-btn" onclick="resetCaseNumbers()">重置编号</button>`:''}
      ${c.is_system&&c.key==='status'?`<button class="secondary reset-column-status-btn" onclick="resetCaseStatus()">重置测试结果</button>`:''}
      ${!c.is_system&&state.editMode?`<select class="convert-system-select" onchange="convertColumnToSystem(${c.id},this.value)"><option value="">转为系统列…</option>${systemOptions}</select>`:''}
      ${!c.is_system?`<button class="danger" onclick="removeCustomColumn(${c.id})">删除</button>`:''}
    </div>`).join('');
  bindColumnDrag();
  openModal('#column-modal');
}

async function resetCaseStatus(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  if(!confirm('确定将当前版本全部用例的执行结果重置为“未执行”吗？'))return;
  try{
    const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/reset-status`,{method:'POST'});
    await Promise.all([loadCases(),loadStats()]);
    showToast(`已重置 ${res.data?.reset||0} 条用例的测试结果`);
  }catch(err){showToast(err.message,'error');}
}

async function convertColumnToSystem(columnId,systemKey){
  if(!systemKey)return;
  const column=state.columns.find(c=>c.id===columnId);if(!column)return;
  if(!confirm(`确定将“${column.name}”转为系统列吗？该列数据会写入对应系统字段。`)){openColumnModal();return;}
  try{
    await api(`/api/columns/${columnId}`,{method:'PUT',body:JSON.stringify({convert_to_system:systemKey})});
    await loadColumns();await loadCases();openColumnModal();renderTable();showToast('列已转换为系统列');
  }catch(err){showToast(err.message,'error');openColumnModal();}
}

function bindColumnDrag(){
  const items=$$('.column-setting-item');
  items.forEach(item=>{
    item.addEventListener('dragstart',e=>{draggedColumnItem=item;item.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    item.addEventListener('dragend',()=>{if(draggedColumnItem)draggedColumnItem.classList.remove('dragging');draggedColumnItem=null;});
    item.addEventListener('dragover',e=>{
      e.preventDefault();
      if(!draggedColumnItem||draggedColumnItem===item)return;
      const rect=item.getBoundingClientRect();
      const mid=rect.top+rect.height/2;
      const parent=item.parentNode;
      if(e.clientY<mid)parent.insertBefore(draggedColumnItem,item);
      else parent.insertBefore(draggedColumnItem,item.nextSibling);
    });
  });
}

const DEFAULT_SYSTEM_COLUMN_ORDER=['case_no','module','title','precondition','steps','expected_result','priority','status','remark'];
function restoreDefaultColumnOrder(){
  const body=$('#column-form-body');
  const items=Array.from(body.querySelectorAll('.column-setting-item'));
  const participating=items.filter(item=>item.dataset.system==='true'&&item.querySelector('.col-vis')?.checked);
  if(participating.length<2){showToast('至少需要两个已勾选的系统列才能整理');return;}
  const order=new Map(DEFAULT_SYSTEM_COLUMN_ORDER.map((key,index)=>[key,index]));
  const sorted=participating.slice().sort((a,b)=>(order.get(a.dataset.key)??999)-(order.get(b.dataset.key)??999));
  const markers=participating.map(item=>{const marker=document.createComment('system-column-order');item.replaceWith(marker);return marker;});
  sorted.forEach((item,index)=>markers[index].replaceWith(item));
  showToast('已恢复系统列默认排序，请点击保存');
}

async function saveColumnSettings(){
  try{
    const items=$$('.column-setting-item');
    const orders={};
    items.forEach((item,idx)=>{orders[item.dataset.id]=idx;});
    await api(`/api/projects/${state.currentProject.id}/columns/order`,{method:'POST',body:JSON.stringify({orders})});
    for(const cb of $$('.col-vis')){
      await api(`/api/columns/${cb.dataset.id}`,{method:'PUT',body:JSON.stringify({is_visible:cb.checked})});
    }
    await loadColumns();
    renderTable();
    closeModal('#column-modal');
    showToast('列设置已保存');
  }catch(err){showToast(err.message,'error');}
}
async function addCustomColumn(){const name=prompt('列显示名称：');const key=prompt('字段标识（英文，如 expected）：');if(!name||!key)return;try{await api(`/api/projects/${state.currentProject.id}/columns`,{method:'POST',body:JSON.stringify({name,key})});await loadColumns();openColumnModal();renderTable();showToast('自定义列已添加');}catch(err){showToast(err.message,'error');}}
async function removeCustomColumn(id){if(!confirm('删除该列会清空所有用例中对应字段的数据，确定继续？'))return;try{await api(`/api/columns/${id}`,{method:'DELETE'});await loadColumns();openColumnModal();renderTable();showToast('列已删除');}catch(err){showToast(err.message,'error');}}

function openImportModal(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本，再导入 Excel','error');return;}
  openModal('#import-modal');$('#import-progress').style.width='0%';$('#import-progress').textContent='';$('#import-result').textContent='';
}
const dropzone=$('#import-dropzone');['dragenter','dragover'].forEach(ev=>{dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add('dragover');});});['dragleave','drop'].forEach(ev=>{dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove('dragover');});});
dropzone.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length)uploadExcel(files[0]);});
dropzone.addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',e=>{if(e.target.files.length)uploadExcel(e.target.files[0]);});
async function uploadExcel(file){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本，再导入 Excel','error');return;}
  $('#import-progress').style.width='10%';$('#import-progress').textContent='解析中...';const form=new FormData();form.append('file',file);
  try{$('#import-progress').style.width='50%';const res=await fetch(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/import`,{method:'POST',body:form});const data=await res.json();if(data.success){$('#import-progress').style.width='100%';$('#import-progress').textContent='100%';$('#import-result').textContent=`导入成功：共导入 ${data.data.imported} 条用例`;await loadColumns();await Promise.all([loadCases(),loadStats()]);setTimeout(()=>closeModal('#import-modal'),1200);}else{throw new Error(data.message);}}catch(err){$('#import-progress').style.width='0%';$('#import-progress').textContent='';$('#import-result').textContent='导入失败：'+err.message;showToast(err.message,'error');}
}

async function backupDb(){
  const path=prompt('请输入备份保存目录（留空使用默认目录）：','');if(path===null)return;
  try{const body=path?JSON.stringify({backup_dir:path}):JSON.stringify({});const res=await api('/api/backup',{method:'POST',body:body});showToast(`备份已保存：${res.data.path}`);}catch(err){showToast(err.message,'error');}
}

// 图片粘贴上传（弹窗内任意位置，包括备注框）
function isImageFile(file){return !!file&&(file.type?.startsWith('image/')||/\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name||''));}
function getPastedImageFiles(event){
  const files=[];
  const clipboard=event.clipboardData;
  if(!clipboard)return files;
  Array.from(clipboard.files||[]).forEach(file=>{if(isImageFile(file))files.push(file);});
  Array.from(clipboard.items||[]).forEach(item=>{
    if(!item.type?.startsWith('image/'))return;
    const file=item.getAsFile?.();
    if(file)files.push(file);
  });
  return files;
}
function uniqueImageFiles(files){
  const seen=new Set();
  return files.filter(file=>{
    const key=[file.type||'',file.size||0,file.lastModified||0,file.name||''].join('|');
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
async function readClipboardHtmlImageFiles(html){
  if(!html)return [];
  const files=[];
  const matches=[...html.matchAll(/<img[^>]+src=["'](data:image\/[\w.+-]+;base64,[^"']+)["'][^>]*>/gi)];
  for(const match of matches){
    try{
      const blob=await fetch(match[1]).then(res=>res.blob());
      if(blob.type?.startsWith('image/')){
        files.push(new File([blob],`pasted-${Date.now()}-${files.length}.png`,{type:blob.type}));
      }
    }catch(err){}
  }
  return uniqueImageFiles(files);
}
async function readClipboardImageFiles(){
  if(!navigator.clipboard?.read)return [];
  const files=[];
  try{
    for(const item of await navigator.clipboard.read()){
      for(const type of item.types||[]){
        if(!type.startsWith('image/'))continue;
        const blob=await item.getType(type);
        files.push(new File([blob],`pasted-${Date.now()}.${type.split('/')[1]||'png'}`,{type}));
      }
    }
  }catch(err){return [];}
  return uniqueImageFiles(files);
}
async function handlePastedImages(files,target=null,selectionRange=null){
  files=uniqueImageFiles(files.filter(isImageFile));
  if(!files.length)return;
  const caseModalActive=$('#case-modal').classList.contains('active');
  const cellModalActive=$('#cell-editor-modal').classList.contains('active');
  const inlineEditingActive=target?.classList?.contains('inline-cell-editor');
  const caseId=caseModalActive?state.editingCase?.id:(cellModalActive?state.editingCell?.caseId:(inlineEditingActive?state.inlineEditing?.caseId:null));
  const richTarget=target?.isContentEditable?target:target?.closest?.('[contenteditable="true"]');
  if(!caseId){
    const accepted=addPendingImages(files);
    if(richTarget){
      for(const file of accepted){
        const token=`pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        state.pendingEmbeddedImages.push({file,token});
        insertImageAtCaret(richTarget,URL.createObjectURL(file),null,token,selectionRange);
        selectionRange=captureRichSelection(richTarget);
      }
    }
    showToast('图片已加入待保存列表');return;
  }
  try{
    const uploaded=await uploadImageFiles(caseId,files);
    for(const image of uploaded){
      const src=getImageSrc(image);
      if(richTarget)insertImageAtCaret(richTarget,src,image.id,null,selectionRange);
      if(state.editingCase?.id===caseId)state.caseModalUploadedImageIds.push(image.id);
      if(state.editingCell?.caseId===caseId)state.editingCell.uploadedImageIds.push(image.id);
      if(state.inlineEditing?.caseId===caseId)state.inlineEditing.uploadedImageIds.push(image.id);
      selectionRange=captureRichSelection(richTarget);
    }
    if(state.editingCase?.id===caseId||state.editingCell?.caseId===caseId)await loadCaseImages(caseId);
    showToast('图片粘贴成功');
  }catch(err){showToast(err.message,'error');}
}
function removeImagePlaceholder(target){
  if(!target)return;
  if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement){
    const next=target.value.replace(/\s*\[图片\]\s*$/,'');
    if(next!==target.value){target.value=next;target.dispatchEvent(new Event('input',{bubbles:true}));}
    return;
  }
  if(target.isContentEditable){
    const nodes=[];const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);
    let node;while(node=walker.nextNode())nodes.push(node);
    let remaining='';
    for(let i=nodes.length-1;i>=0;i--){
      if(!remaining)remaining=nodes[i].textContent;
      else remaining=nodes[i].textContent+remaining;
    }
    if(!/^\s*\[图片\]\s*$/.test(remaining))return;
    const last=nodes[nodes.length-1];if(last)last.textContent=last.textContent.replace(/\s*\[图片\]\s*$/,'');
  }
}
function setupPasteHandler(){
  document.addEventListener('paste',async e=>{
    const modal=$('#case-modal');
    const cellModal=$('#cell-editor-modal');
    const target=e.target?.closest?.('[contenteditable="true"]')||e.target;
    const inlineEditor=target?.classList?.contains('inline-cell-editor');
    if(!modal.classList.contains('active')&&!cellModal.classList.contains('active')&&!inlineEditor)return;
    const selectionRange=captureRichSelection(target);
    let files=getPastedImageFiles(e);
    const clipboardTypes=Array.from(e.clipboardData?.types||[]);
    const plainText=e.clipboardData?.getData('text/plain')||'';
    const html=e.clipboardData?.getData('text/html')||'';
    const imagePlaceholder=/^\s*\[图片\]\s*$/.test(plainText);
    const mayContainImage=files.length||imagePlaceholder||clipboardTypes.includes('Files')||clipboardTypes.some(type=>type.startsWith('image/'));
    if(!mayContainImage)return;
    e.preventDefault();
    if(!files.length)files=await readClipboardImageFiles();
    if(!files.length)files=await readClipboardHtmlImageFiles(html);
    removeImagePlaceholder(target);
    await handlePastedImages(files,target,selectionRange);
  },true);
}
setupPasteHandler();
document.addEventListener('keydown',e=>{
  if(!e.ctrlKey||!e.shiftKey||e.key.toLowerCase()!=='x')return;
  const target=e.target?.closest?.('[contenteditable="true"]');
  if(!target)return;
  e.preventDefault();
  toggleStrike();
});
document.addEventListener('click',e=>{
  const image=e.target?.closest?.('.rich-content-image');
  if(!image)return;
  e.preventDefault();e.stopPropagation();openLightbox(image.currentSrc||image.src);
},true);

function bindColumnResize(){
  $$('.resize-handle').forEach(handle=>{
    handle.onmousedown=e=>{
      e.preventDefault();e.stopPropagation();
      const th=handle.closest('th');
      const key=th.dataset.key;
      const startX=e.clientX;
      const startW=th.offsetWidth;
      function onMove(ev){
        const w=Math.max(60,startW+ev.clientX-startX);
        th.style.width=w+'px';
      }
      function onUp(){
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
        const col=state.columns.find(c=>c.key===key);
        if(col){
          col.width=Math.max(60,th.offsetWidth);
          api(`/api/columns/${col.id}`,{method:'PUT',body:JSON.stringify({width:col.width})}).catch(()=>{});
        }
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    };
  });
}

// 事件绑定
$('#btn-add-project').onclick=createProject;
$('#btn-add-case').onclick=addCase;
$('#btn-import').onclick=openImportModal;
$('#btn-columns').onclick=openColumnModal;
$('#btn-backup').onclick=backupDb;
$('#btn-search').onclick=()=>{state.keyword=$('#search-input').value;state.page=1;loadCases();};
$('#search-input').addEventListener('keydown',e=>{if(e.key==='Enter')$('#btn-search').click();});
$('#save-case-btn').onclick=saveCase;
$('#save-column-btn').onclick=saveColumnSettings;
$('#add-custom-column-btn').onclick=addCustomColumn;
$('#restore-default-columns-btn').onclick=restoreDefaultColumnOrder;
$('#edit-mode-toggle').addEventListener('change',e=>{state.editMode=e.target.checked;updateEditModeUI();renderProjects();renderTable();});
$('#btn-toggle-sidebar').onclick=()=>{state.sidebarCollapsed=!state.sidebarCollapsed;$('#sidebar').classList.toggle('collapsed',state.sidebarCollapsed);};
$('#btn-add-version').onclick=createVersion;
$('#btn-quick-add').onclick=addQuickRow;
$('#btn-summary').onclick=openSummaryModal;
$('#btn-merge-cells').onclick=()=>toggleMergeMode('merge');
$('#btn-unmerge-cells').onclick=()=>toggleMergeMode('unmerge');
$('#btn-batch-delete').onclick=deleteSelectedCases;
function updateEditModeUI(){
  const button=$('#btn-batch-delete');
  if(button)button.style.display=state.editMode?'inline-flex':'none';
}
updateEditModeUI();
$('#cell-editor-input').addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();closeCellEditor();}
  if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();saveCellEditor();}
});
$$('.modal-overlay').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('active');});});
